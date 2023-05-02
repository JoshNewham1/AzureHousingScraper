# Azure Housing Scraper

## Table of Contents

- [Azure Housing Scraper](#azure-housing-scraper)
  - [Table of Contents](#table-of-contents)
  - [Introduction](#introduction)
  - [What it does](#what-it-does)
  - [How it works](#how-it-works)
    - [`function.json`](#functionjson)
    - [`index.ts`](#indexts)
    - [`gumtree.ts`](#gumtreets)
    - [`rightmove.ts`](#rightmovets)
  - [Setup](#setup)
    - [Prerequisites](#prerequisites)
    - [Deployment](#deployment)

## Introduction

This project aimed to solve the problem of having to trawl through property listings (currently on Rightmove and Gumtree) daily to try and find a flat in Edinburgh, though it can obviously be used elsewhere.

Both services do have email alerts but I found these unreliable and badly formatted, plus learning Azure Functions and serverless things in general was fun (and this whole project can be hosted for free!)

## What it does

Twice a day, at 9am and 5pm, an Azure function is run that goes to the property listing websites and
scrapes metadata on all the properties listed. It then saves this and sends out an email.

In more detail, the function:

- Launches Puppeteer, a headless web browser used for testing
- Navigates to property websites and scrapes all properties from a search link
- Does a diff on the last time it ran to see what's changed (added / updated properties)
- Sends an email with the changed properties
- Stores the JSON in Azure Blob Storage so it can be reported on (in Power BI)

## How it works

### `function.json`

The `function.json` file contains configurations that you may wish to change including:

- `schedule` - how often the Azure function runs (in cron format)
- `inputJson` - the path to the JSON in blob storage (read in to do the diff)
- `outputJson` - the path to the JSON in blob storage (written to after scraping)
- `retry` - the retry strategy the function should use if it fails (due to Puppeteer timing out etc)
  - Currently it tries again up to a max of 6 times, with a 5 minute interval inbetween

### `index.ts`

The entry point for the function, sets off the scraping and does the diff / emailing at the end

### `gumtree.ts`

Code to start up the web browser and scrape all pages of a Gumtree search link

### `rightmove.ts`

Code to start up the web browser and scrape all pages of a Rightmove search link

## Setup

### Prerequisites

1. An Azure account (can be free)
2. A resource group for all the scraper-related resources
3. The provisioning of the following resources
   1. A Node.js function app (>= v16 LTS, on Linux, Consumption plan)
   2. A storage account
   3. An Application Insights resource (for logging)
4. The following environment variables _(Application Settings)_ being added to the Function App > Configuration
   1. `GOOGLE_APP_PASSWORD` - an App Password for Gmail to authenticate the email sender. Generated on
      [Google Account page](myaccount.google.com) under "2-Step Verification"
   2. `SENDER_EMAIL` - the Gmail address you want to send from
   3. `RECIPIENT_EMAIL` - the emaill address(es) you want to send to. Separate with a semi-colon if more than one
   4. `RIGHTMOVE_LINK` - the Rightmove search link to scrape daily. e.g. [this link](https://www.rightmove.co.uk/property-to-rent/find.html?locationIdentifier=REGION%5E475&minBedrooms=3&radius=3.0&sortType=1&propertyTypes=&includeLetAgreed=false&mustHave=student&dontShow=&furnishTypes=&keywords=)
   5. `GUMTREE_LINK` - the Rightmove search link to scrape daily. e.g. [this link](https://www.gumtree.com/search?featured_filter=false&q=&min_property_number_beds=3&search_category=property-to-rent&urgent_filter=false&sort=date&max_property_number_beds=5&search_distance=3&search_scope=false&photos_filter=false&search_location=EH11JT&distance=3)
5. A dummy JSON file (can just be a file with `{}` in it) uploaded to Azure Blob Storage at the path
   specified in `function.json`

### Deployment

1. Ensure you've fulfilled the prerequisites
2. Install the Azure Functions VS Code extension
3. Clone this repo locally and open it in VS Code
4. Go to the Azure icon in the left-hand panel and press the Deploy button (cloud icon)
5. Follow the instructions
