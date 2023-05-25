import { Context } from "@azure/functions";
import * as puppeteer from "puppeteer";
import { delay } from "./utils";

// Scroll down the page by the height of the window until we reach the bottom
// Delay by 100ms to give content time to start loading
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
  const startingUrl = process.env["GUMTREE_LINK"];
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
  // Get the number of pages in the pagination element at the bottom
  const numPages = await page.evaluate(() => {
    const pageNumbers = document.querySelectorAll(".pagination-page");
    const lastPageNumber = pageNumbers[pageNumbers.length - 1] as HTMLLIElement;
    return parseInt(lastPageNumber?.innerText || "1");
  });
  context.log(`${numPages} pages found on Gumtree website`);
  let properties = {};
  for (let i = 1; i <= numPages; i++) {
    // Add jQuery to the page so we can use it to more easily scrape elements
    await page.addScriptTag({
      url: "https://code.jquery.com/jquery-3.3.1.slim.min.js",
    });
    // Create an object with all the properties on the current page and their attributes
    const thisPage = await page.evaluate(() =>
      $("article.listing-maxi")
        .map(function () {
          // Remove the miles distance from address
          let address = $(this).find(".listing-location > span").text().trim();
          if (address.includes("|")) {
            address = address.split("|")[1];
          }

          const type =
            // Whether it's a house or a flat
            $(this)
              .find('span:contains("Property type")')
              .first()
              .parent()
              .children()
              .last()
              .text();

          const link =
            "https://www.gumtree.com" +
            $(this).find(".listing-link").attr("href");

          const bedrooms =
            // Find number of bedrooms text and strip any non numbers
            parseInt(
              $(this)
                .find('span:contains("Number of bedrooms")')
                .first()
                .parent()
                .children()
                .last()
                .text()
                .match(/\d+/)[0]
            );

          const pricePerMonth =
            // Get price value, strip any text and convert to integer
            parseInt(
              $(this)
                .find(".listing-price > strong")
                .first()
                .text()
                .match(/\d+/g)
                .join("")
            );

          const image = $(this).find(".listing-thumbnail > img").attr("src");

          const availableDate =
            // Date available text with "Date available: " stripped
            $(this)
              .find('span:contains("Date available")')
              .first()
              .parent()
              .children()
              .last()
              .text()
              .replace("Date available: ", "");

          return {
            address,
            type,
            link,
            bedrooms,
            // Get price value, strip any text and convert to integer
            pricePerMonth,
            pricePerMonthPerPerson: (pricePerMonth / bedrooms).toFixed(2),
            pricePerWeek: (pricePerMonth / 4).toFixed(2),
            image,
            availableDate,
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
