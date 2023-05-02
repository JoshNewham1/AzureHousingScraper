import { AzureFunction, Context } from "@azure/functions";
import { detailedDiff } from "deep-object-diff";
import { createTransport } from "nodemailer";
import { scrapeGumtree } from "./gumtree";
import { scrapeRightMove } from "./rightmove";
import { buildEmailHtml } from "./utils";

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
  // When the timer is triggered (daily)
  try {
    const oldProperties = JSON.parse(
      context.bindings.inputJson.toString("utf8")
    );

    // Open Puppeteer and scrape
    const rightmoveProperties = await scrapeRightMove(context);
    const gumtreeProperties = await scrapeGumtree(context);
    const properties = { ...rightmoveProperties, ...gumtreeProperties };
    const propertiesDiff = detailedDiff(oldProperties, properties);
    context.log(
      `Object diff:\n
      ${JSON.stringify(propertiesDiff)}`
    );

    // Write file with all properties to Azure Blob Storage
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

    const emailer = createTransport({
      host: "smtp.gmail.com",
      secure: true,
      port: 465,
      auth: {
        user: process.env["SENDER_EMAIL"],
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
      emailer.sendMail(
        {
          from: process.env["SENDER_EMAIL"],
          to: process.env["RECIPIENT_EMAIL"],
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
