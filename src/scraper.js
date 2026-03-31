import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";
import { extractSellerPrice } from "./sellerParsers.js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "../config/products.csv");
const outputPath = path.join(__dirname, "../data/results.json");
const dataDir = path.join(__dirname, "../data");

const trackedSellers = ["Ябко", "iStore", "MacLove", "GRO"];

const isHeadless = process.env.HEADLESS !== "false";

function parseNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const normalized = String(value).replace(",", ".").trim();
  const parsed = Number(normalized);

  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesTargetSeller(cardText) {
  const normalized = normalizeText(cardText);

  return (
    trackedSellers.find((seller) =>
      normalized.includes(normalizeText(seller)),
    ) || null
  );
}

async function resolveRedirect(context, url) {
  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(2000);

    return page.url();
  } catch (error) {
    console.error(`Redirect resolve failed: ${url}`, error.message);
    return null;
  } finally {
    await page.close();
  }
}

async function getMarketDataFromHotline(url, product) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
      },
    });

    const $ = cheerio.load(response.data);
    const jsonLdScripts = $('script[type="application/ld+json"]');

    let productData = null;

    jsonLdScripts.each((i, el) => {
      const jsonText = $(el).html();

      if (!jsonText || !jsonText.includes('"@type":"Product"')) return;

      try {
        const parsed = JSON.parse(jsonText);
        productData = parsed;
      } catch (error) {
        console.error(
          `JSON parse error for ${product.MODEL} (${product.ARTICLE}):`,
          error.message,
        );
      }
    });

    return {
      marketLowPrice: parseNumber(productData?.offers?.lowPrice),
      marketHighPrice: parseNumber(productData?.offers?.highPrice),
      marketOfferCount: parseNumber(productData?.offers?.offerCount),
      priceCurrency: productData?.offers?.priceCurrency || null,
      availability: productData?.offers?.availability || null,
    };
  } catch (error) {
    console.error(
      `Hotline market data fetch failed for ${product.MODEL} (${product.ARTICLE}):`,
      error.message,
    );

    return {
      marketLowPrice: null,
      marketHighPrice: null,
      marketOfferCount: null,
      priceCurrency: null,
      availability: null,
    };
  }
}

async function findTrackedSellerCards(page, article) {
  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(1500);

  const cardLocator = page.locator("div").filter({ hasText: "КУПИТИ" });
  const count = await cardLocator.count();

  const matchedCards = [];

  for (let i = 0; i < count; i++) {
    const card = cardLocator.nth(i);

    const cardText = await card.innerText().catch(() => "");
    if (!cardText) continue;

    const sellerMatch = matchesTargetSeller(cardText);
    const articleMatch = cardText.includes(article);

    if (!sellerMatch || !articleMatch) continue;

    const box = await card.boundingBox();
    if (!box) continue;

    if (box.width < 1000) continue;
    if (box.height < 100 || box.height > 260) continue;
    if (box.y < 400) continue;

    const buyLinks = await card
      .locator('a[href*="/go/price/"]')
      .evaluateAll((links) =>
        links.map((a) => ({
          href: a.href,
          text: (a.innerText || a.textContent || "").trim(),
          className: a.className || "",
        })),
      );

    const buyButtonLink =
      buyLinks.find(
        (link) =>
          link.text === "КУПИТИ" ||
          String(link.className).includes("btn btn--orange"),
      ) || null;

    matchedCards.push({
      seller: sellerMatch,
      article,
      cardText: cardText.slice(0, 500),
      buyButtonLink,
      buyLinks,
    });
  }

  return matchedCards;
}

async function extractTrackedSellerResults(context, hotlineUrl, article) {
  const page = await context.newPage();

  try {
    await page.goto(hotlineUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const matchedCards = await findTrackedSellerCards(page, article);

    const sellerResults = [];

    for (const card of matchedCards) {
      if (!card.buyButtonLink?.href) continue;

      const finalUrl = await resolveRedirect(context, card.buyButtonLink.href);
      if (!finalUrl) continue;

      const sellerPage = await context.newPage();

      try {
        const result = await extractSellerPrice(
          sellerPage,
          card.seller,
          finalUrl,
        );

        sellerResults.push({
          seller: result.seller,
          sellerParser: result.sellerParser,
          finalUrl: result.finalUrl,
          currentPrice: result.currentPrice,
          oldPrice: result.oldPrice,
          diffPrice: result.diffPrice,
          raw: result.raw,
        });
      } catch (error) {
        console.error(
          `Seller parse failed for ${card.seller} (${article}):`,
          error.message,
        );
      } finally {
        await sellerPage.close();
      }
    }

    return sellerResults;
  } finally {
    await page.close();
  }
}

function getTrackedSellerLowPrice(trackedSellerResults) {
  const prices = trackedSellerResults
    .map((item) => item.currentPrice)
    .filter((price) => typeof price === "number" && price > 0)
    .sort((a, b) => a - b);

  return prices.length ? prices[0] : null;
}

function dedupeTrackedSellerResults(trackedSellerResults) {
  if (
    !Array.isArray(trackedSellerResults) ||
    trackedSellerResults.length === 0
  ) {
    return [];
  }

  const bestBySeller = new Map();

  for (const item of trackedSellerResults) {
    if (!item?.seller) continue;

    const key = String(item.seller).trim().toLowerCase();
    const existing = bestBySeller.get(key);

    const currentPrice =
      typeof item.currentPrice === "number" && !Number.isNaN(item.currentPrice)
        ? item.currentPrice
        : null;

    if (!existing) {
      bestBySeller.set(key, item);
      continue;
    }

    const existingPrice =
      typeof existing.currentPrice === "number" &&
      !Number.isNaN(existing.currentPrice)
        ? existing.currentPrice
        : null;

    if (existingPrice === null && currentPrice !== null) {
      bestBySeller.set(key, item);
      continue;
    }

    if (
      existingPrice !== null &&
      currentPrice !== null &&
      currentPrice < existingPrice
    ) {
      bestBySeller.set(key, item);
    }
  }

  return [...bestBySeller.values()].sort((a, b) => {
    const aPrice =
      typeof a.currentPrice === "number" && !Number.isNaN(a.currentPrice)
        ? a.currentPrice
        : Number.POSITIVE_INFINITY;

    const bPrice =
      typeof b.currentPrice === "number" && !Number.isNaN(b.currentPrice)
        ? b.currentPrice
        : Number.POSITIVE_INFINITY;

    return aPrice - bPrice;
  });
}

async function run() {
  const products = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        products.push(row);
      })
      .on("end", resolve)
      .on("error", reject);
  });

  console.log(`CSV loaded: ${products.length} products`);

  console.log(`Launching browser. Headless: ${isHeadless}`);
  const browser = await chromium.launch({ headless: isHeadless });

  const context = await browser.newContext({
    viewport: { width: 1728, height: 2400 },
  });

  const results = [];

  try {
    for (const product of products) {
      const hotlineUrl = product.HOTLINE_URL;
      const article = product.ARTICLE;
      const rrp = parseNumber(product.RRP);

      console.log(`Processing: ${product.MODEL} (${article})`);

      try {
        const marketData = await getMarketDataFromHotline(hotlineUrl, product);

        const rawTrackedSellerResults = await extractTrackedSellerResults(
          context,
          hotlineUrl,
          article,
        );

        const trackedSellerResults = dedupeTrackedSellerResults(
          rawTrackedSellerResults,
        );

        const trackedSellerLowPrice =
          getTrackedSellerLowPrice(trackedSellerResults);

        const finalLowPrice =
          trackedSellerLowPrice ?? marketData.marketLowPrice;

        const deltaToRrp =
          rrp !== null && finalLowPrice !== null
            ? Number((finalLowPrice - rrp).toFixed(2))
            : null;

        const deltaToRrpPercent =
          rrp !== null && finalLowPrice !== null
            ? Number((((finalLowPrice - rrp) / rrp) * 100).toFixed(1))
            : null;

        const result = {
          date: new Date().toISOString().split("T")[0],
          category: product.CATEGORY,
          article: product.ARTICLE,
          model: product.MODEL,
          storage: product.STORAGE,
          color: product.COLOR,
          hotlineUrl: product.HOTLINE_URL,

          rrp,
          marketLowPrice: marketData.marketLowPrice,
          marketHighPrice: marketData.marketHighPrice,
          marketOfferCount: marketData.marketOfferCount,

          trackedSellerResults,
          trackedSellerLowPrice,
          finalLowPrice,

          deltaToRrp,
          deltaToRrpPercent,

          priceCurrency: marketData.priceCurrency,
          availability: marketData.availability,
        };

        results.push(result);

        console.log("RESULT:", {
          model: result.model,
          article: result.article,
          trackedSellerLowPrice: result.trackedSellerLowPrice,
          marketLowPrice: result.marketLowPrice,
          finalLowPrice: result.finalLowPrice,
          trackedSellerCount: result.trackedSellerResults.length,
        });
      } catch (error) {
        console.error(
          `Processing failed for ${product.MODEL} (${article}):`,
          error.message,
        );

        results.push({
          date: new Date().toISOString().split("T")[0],
          category: product.CATEGORY,
          article: product.ARTICLE,
          model: product.MODEL,
          storage: product.STORAGE,
          color: product.COLOR,
          hotlineUrl: product.HOTLINE_URL,

          rrp,
          marketLowPrice: null,
          marketHighPrice: null,
          marketOfferCount: null,

          trackedSellerResults: [],
          trackedSellerLowPrice: null,
          finalLowPrice: null,

          deltaToRrp: null,
          deltaToRrpPercent: null,

          priceCurrency: null,
          availability: null,
          error: error.message,
        });
      }
    }
  } finally {
    await browser.close();
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");

  console.log(`Results saved to: ${outputPath}`);
  console.log("Done.");
}

run().catch((error) => {
  console.error("Fatal scraper error:", error.message);
});
