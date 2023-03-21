import { AzureFunction, Context } from "@azure/functions";
import { detailedDiff } from "deep-object-diff";
import { createTransport } from "nodemailer";
import * as puppeteer from "puppeteer";

const delay = (delayMs: number) => {
  return new Promise<void>((res, _) => {
    setTimeout(() => res(), delayMs);
  });
};

const scrapeRightMove = async (context: Context) => {
  const startingUrl =
    "https://www.rightmove.co.uk/property-to-rent/find.html?locationIdentifier=REGION%5E475&minBedrooms=3&radius=3.0&sortType=1&propertyTypes=&includeLetAgreed=false&mustHave=student&dontShow=&furnishTypes=&keywords=";
  const browser = await puppeteer.launch({
    headless: true,
    timeout: 0,
  });
  const page = await browser.newPage();
  context.log("Launched puppeteer");
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.61 Safari/537.36"
  );
  await page.goto(startingUrl);
  await page.waitForSelector(".propertyCard-wrapper");
  await page.addScriptTag({
    url: "https://code.jquery.com/jquery-3.3.1.slim.min.js",
  });
  const numPages = await page.evaluate(() =>
    parseInt(
      document.querySelector("div.pagination-pageSelect > span:nth-child(4)")
        .innerHTML
    )
  );
  context.log(`${numPages} pages found on Rightmove website`);
  let properties = {};
  for (let i = 1; i <= numPages; i++) {
    const thisPage = await page.evaluate(() => {
      return Promise.all(
        $(".propertyCard-wrapper")
          .map(async function () {
            const link =
              "https://www.rightmove.co.uk" +
              $(this).find(".propertyCard-link").attr("href");
            const metadata = await fetch(link).then((res) => res.text());
            return {
              address: $(this).find(".propertyCard-address").text().trim(),
              type: $(this)
                .find(".propertyCard-details > a > div > span:nth-child(1)")
                .text()
                .trim(),
              link,
              bedrooms: parseInt(
                $(this)
                  .find(".propertyCard-details > a > div > span:nth-child(3)")
                  .text()
              ),
              // Get price value, strip any text and convert to integer
              pricePerMonth: parseInt(
                $(this)
                  .find(".propertyCard-priceValue")
                  .text()
                  .trim()
                  .match(/\d+/g)
                  .join("")
              ),
              pricePerMonthPerPerson: (
                parseInt(
                  $(this)
                    .find(".propertyCard-priceValue")
                    .text()
                    .trim()
                    .match(/\d+/g)
                    .join("")
                ) /
                parseInt(
                  $(this)
                    .find(".propertyCard-details > a > div > span:nth-child(3)")
                    .text()
                )
              ).toFixed(2),
              pricePerWeek: parseInt(
                $(this)
                  .find(".propertyCard-secondaryPriceValue")
                  .text()
                  .trim()
                  .match(/\d+/g)[0]
              ),
              image: $(this).find(".propertyCard-img > img").attr("src"),
              availableDate: $(metadata)
                .find(
                  "main > div > div > div > article:nth-child(4) > div > dl > div:nth-child(1) > dd"
                )
                .text(),
              furnished: $(metadata)
                .find(
                  "main > div > div > div > article:nth-child(4) > div > dl > div:nth-child(4) > dd"
                )
                .text(),
              agent: $(metadata)
                .find(
                  "main > div > div > div > article:nth-child(22) > div > div > h3"
                )
                .text(),
            };
          })
          .toArray()
      );
    });
    context.log(`Page ${i} scraped, ${thisPage.length} properties scraped`);

    // Add all entries from the page into object
    // using a composite key of address, agent, pricePerMonth and bedrooms
    // to be unique (as some properties change their URL daily)
    for (const property of thisPage) {
      const compositeKey =
        property.address +
        property.agent +
        property.pricePerMonth +
        property.bedrooms;
      properties[compositeKey] = property;
    }
    await page.click(".pagination-direction--next");
    await delay(1000);
  }
  return properties;
};

const buildEmailHtml = (properties: object, subtitle: string) => {
  let emailHtml = `<h2>${subtitle}</h2>`;
  Object.keys(properties).forEach((key) => {
    emailHtml += `
    <div style="margin-bottom: 25px;">
      <a href="${properties[key]["link"]}">Link</a>
    `;

    Object.keys(properties[key])?.forEach((detail) => {
      if (detail === "link" || detail === "pricePerWeek") {
        // Skip link and weekly price attribs
        return;
      } else if (detail === "image") {
        emailHtml += `<p><b>${detail}:</b> <img src="${properties[key][detail]}" width="200"> </p>`;
        return;
      } else if (detail.includes("price")) {
        emailHtml += `<p><b>${detail}:</b> £${properties[key][detail]}</p>`;
        return;
      }
      emailHtml += `<p><b>${detail}:</b> ${properties[key][detail]}</p>`;
    });

    emailHtml += "</div><hr>";
  });
  return emailHtml;
};

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
  try {
    const oldProperties = JSON.parse(
      context.bindings.inputJson.toString("utf8")
    );

    // Open Puppeteer and scrape
    const properties = await scrapeRightMove(context);
    const propertiesDiff = detailedDiff(oldProperties, properties);
    context.log(
      `Object diff:\n
      ${JSON.stringify(propertiesDiff)}`
    );

    // Write file to Azure Blob Storage
    context.bindings.outputJson = JSON.stringify(properties);
    context.log("Written JSON file to Blob Storage successfully");

    // Send email if any differences
    if (
      propertiesDiff["added"] &&
      propertiesDiff["updated"] &&
      Object.keys(propertiesDiff["added"]).length === 0 &&
      Object.keys(propertiesDiff["updated"]).length === 0
    ) {
      return;
    }

    const transporter = createTransport({
      host: "smtp.gmail.com",
      secure: true,
      port: 465,
      auth: {
        user: "joshnewham456@gmail.com",
        pass: process.env["GOOGLE_APP_PASSWORD"],
      },
    });

    let emailHtml = "<h1>RightMove Updates</h1>";
    let numProperties = 0;
    if (
      propertiesDiff["added"] &&
      Object.keys(propertiesDiff["added"]).length > 0
    ) {
      emailHtml += buildEmailHtml(propertiesDiff["added"], "Added Properties");
      numProperties = Object.keys(propertiesDiff["added"]).length;
    }
    if (
      propertiesDiff["updated"] &&
      Object.keys(propertiesDiff["updated"]).length > 0
    ) {
      emailHtml += buildEmailHtml(propertiesDiff["updated"], "Updates");
    }

    await new Promise<void>((res, rej) =>
      transporter.sendMail(
        {
          from: "joshnewham456@gmail.com",
          to: "joshnewham@live.com",
          subject: `Flat Search - ${numProperties} new properties`,
          html: emailHtml,
        },
        (err, info) => {
          if (err) {
            context.log(err);
            rej();
          } else {
            context.log("Email sent: " + info.response);
            res();
          }
        }
      )
    );
  } catch (err) {
    context.log.error(err);
    throw err;
  }
};

export default timerTrigger;
