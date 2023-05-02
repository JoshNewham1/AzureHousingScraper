import { Context } from "@azure/functions";
import * as puppeteer from "puppeteer";
import { delay } from "./utils";

export const scrapeRightMove = async (context: Context) => {
  const startingUrl = process.env["RIGHTMOVE_LINK"];
  const browser = await puppeteer.launch({
    headless: true,
    timeout: 0,
  });
  const page = await browser.newPage();
  context.log("Launched puppeteer for Rightmove");
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.61 Safari/537.36"
  );
  await page.goto(startingUrl);
  await page.waitForSelector(".propertyCard-wrapper");
  // Add jQuery to the page so we can use it for selectors
  // Note: this only needs to be done once for Rightmove as it uses AJAX and doesn't load any new pages
  await page.addScriptTag({
    url: "https://code.jquery.com/jquery-3.3.1.slim.min.js",
  });
  // Get the number of pages in the pagination element at the bottom
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
            // Scrape all the content from HTML elements on the page
            const link =
              "https://www.rightmove.co.uk" +
              $(this).find(".propertyCard-link").attr("href");

            // "Click into" the property to get more metadata
            const metadata = await fetch(link).then((res) => res.text());

            const address = $(this).find(".propertyCard-address").text().trim();

            const type =
              // Property type (flat or house)
              $(this)
                .find(".propertyCard-details > a > div > span:nth-child(1)")
                .text()
                .trim();

            const bedrooms = parseInt(
              $(this)
                .find(".propertyCard-details > a > div > span:nth-child(3)")
                .text()
            );

            const pricePerMonth =
              // Get price value, strip any text and convert to integer
              parseInt(
                $(this)
                  .find(".propertyCard-priceValue")
                  .text()
                  .trim()
                  .match(/\d+/g)
                  .join("")
              );

            const pricePerWeek = parseInt(
              $(this)
                .find(".propertyCard-secondaryPriceValue")
                .text()
                .trim()
                .match(/\d+/g)[0]
            );

            const image = $(this).find(".propertyCard-img > img").attr("src");

            const availableDate =
              // Use a nasty selector to get the available date text (it has no class or id)
              $(metadata)
                .find(
                  "main > div > div > div > article:nth-child(4) > div > dl > div:nth-child(1) > dd"
                )
                .text();

            const furnished = $(metadata)
              .find(
                "main > div > div > div > article:nth-child(4) > div > dl > div:nth-child(4) > dd"
              )
              .text();

            const agent =
              // Estate agent
              $(metadata)
                .find(
                  "main > div > div > div > article:nth-child(22) > div > div > h3"
                )
                .text();

            return {
              address,
              type,
              link,
              bedrooms,
              pricePerMonth,
              pricePerMonthPerPerson: (pricePerMonth / bedrooms).toFixed(2),
              pricePerWeek,
              image,
              availableDate,
              furnished,
              agent,
            };
          })
          .toArray()
      );
    });
    context.log(
      `Rightmove: page ${i} scraped, ${thisPage.length} properties scraped`
    );

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
