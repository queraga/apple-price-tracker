import { chromium } from "playwright";
import { extractSellerPrice } from "./sellerParsers.js";

const hotlineUrl =
  "https://hotline.ua/ua/mobile-mobilnye-telefony-i-smartfony/apple-iphone-17-256gb-black/";

const targetArticle = "MG6J4";
const targetSellers = ["Ябко", "iStore", "MacLove", "GRO"];

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesTargetSeller(cardText) {
  const normalized = normalizeText(cardText);

  return targetSellers.find((seller) =>
    normalized.includes(normalizeText(seller)),
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

async function run() {
  console.log("test-hotline-to-seller-price started");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1728, height: 2400 },
  });

  const page = await context.newPage();

  await page.goto(hotlineUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(1500);

  const cardLocator = page.locator("div").filter({ hasText: "КУПИТИ" });
  const count = await cardLocator.count();

  console.log(`Cards found: ${count}`);

  const matchedCards = [];

  for (let i = 0; i < count; i++) {
    const card = cardLocator.nth(i);

    const cardText = await card.innerText().catch(() => "");
    if (!cardText) continue;

    const sellerMatch = matchesTargetSeller(cardText);
    const articleMatch = cardText.includes(targetArticle);

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
      article: targetArticle,
      cardText: cardText.slice(0, 500),
      buyButtonLink,
      buyLinks,
    });
  }

  console.log("\n=== MATCHED CARDS ===");
  console.dir(matchedCards, { depth: null });

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

      sellerResults.push(result);

      console.log("\n=== SELLER RESULT ===");
      console.dir(result, { depth: null });
    } catch (error) {
      console.error(`Seller parse failed for ${card.seller}:`, error.message);
    } finally {
      await sellerPage.close();
    }
  }

  console.log("\n=== FINAL RESULTS ===");
  console.dir(sellerResults, { depth: null });

  await browser.close();

  console.log("test-hotline-to-seller-price finished");
}

run().catch(console.error);
