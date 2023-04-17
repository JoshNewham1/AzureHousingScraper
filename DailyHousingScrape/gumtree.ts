import { Context } from "@azure/functions";
import * as puppeteer from "puppeteer";
import { delay } from "./utils";

const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        var scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve("");
        }
      }, 100);
    });
  });
};

export const scrapeGumtree = async (context: Context) => {
  const startingUrl =
    "https://www.gumtree.com/search?featured_filter=false&q=&min_property_number_beds=3&search_category=property-to-rent&urgent_filter=false&sort=date&max_property_number_beds=5&search_distance=3&search_scope=false&photos_filter=false&search_location=EH11JT&distance=3";
  const browser = await puppeteer.launch({
    headless: true,
    timeout: 0,
  });
  const page = await browser.newPage();
  context.log("Launched puppeteer for Gumtree");
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36"
  );
  await page.goto(startingUrl);
  await page.setViewport({
    width: 1200,
    height: 800,
  });
  await page.waitForNetworkIdle();
  // Scroll to the bottom of the page to load pagination
  await autoScroll(page);
  await delay(1000);
  const numPages = await page.evaluate(() => {
    const pageNumbers = document.querySelectorAll(".pagination-page");
    const lastPageNumber = pageNumbers[pageNumbers.length - 1] as HTMLLIElement;
    return parseInt(lastPageNumber.innerText);
  });
  context.log(`${numPages} pages found on Gumtree website`);
  let properties = {};
  for (let i = 1; i <= numPages; i++) {
    await page.addScriptTag({
      url: "https://code.jquery.com/jquery-3.3.1.slim.min.js",
    });
    const thisPage = await page.evaluate(() =>
      $("article.listing-maxi")
        .map(function () {
          // Remove the miles distance from address
          let address = $(this).find(".listing-location > span").text().trim();
          if (address.includes("|")) {
            address = address.split("|")[1];
          }
          return {
            address,
            type: $(this)
              .find('span:contains("Property type")')
              .first()
              .parent()
              .children()
              .last()
              .text(),
            link:
              "https://www.gumtree.com" +
              $(this).find(".listing-link").attr("href"),
            bedrooms: parseInt(
              $(this)
                .find('span:contains("Number of bedrooms")')
                .first()
                .parent()
                .children()
                .last()
                .text()
                .match(/\d+/)[0]
            ),
            // Get price value, strip any text and convert to integer
            pricePerMonth: parseInt(
              $(this)
                .find(".listing-price > strong")
                .first()
                .text()
                .match(/\d+/g)
                .join("")
            ),
            pricePerMonthPerPerson: (
              parseInt(
                $(this)
                  .find(".listing-price > strong")
                  .first()
                  .text()
                  .match(/\d+/g)
                  .join("")
              ) /
              parseInt(
                $(this)
                  .find('span:contains("Number of bedrooms")')
                  .first()
                  .parent()
                  .children()
                  .last()
                  .text()
                  .match(/\d+/)[0]
              )
            ).toFixed(2),
            pricePerWeek:
              parseInt(
                $(this)
                  .find(".listing-price > strong")
                  .first()
                  .text()
                  .match(/\d+/g)
                  .join("")
              ) / 4,
            image: $(this).find(".listing-thumbnail > img").attr("src"),
            availableDate: $(this)
              .find('span:contains("Date available")')
              .first()
              .parent()
              .children()
              .last()
              .text()
              .replace("Date available: ", ""),
            furnished: "Furnished", // Gumtree has no field for this so just assume it is
            agent: "Gumtree",
          };
        })
        .toArray()
    );
    context.log(
      `Gumtree: page ${i} scraped, ${thisPage.length} properties scraped`
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

    // Still pages left to go through
    if (i !== numPages) {
      await page.goto(startingUrl + "&page=" + i);
      // Scroll to the bottom of the page
      await autoScroll(page);
    }
  }
  return properties;
};
