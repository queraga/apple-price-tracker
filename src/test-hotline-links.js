import { chromium } from "playwright";

async function resolveRedirect(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1200 },
  });

  const temp = await context.newPage();

  try {
    await temp.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await temp.waitForTimeout(3000);

    const finalUrl = temp.url();

    await context.close();

    return finalUrl;
  } catch (e) {
    await context.close();
    return null;
  }
}

const hotlineUrl =
  "https://hotline.ua/ua/mobile-mobilnye-telefony-i-smartfony/apple-iphone-17-256gb-black/";

const targetArticle = "MG6J4";

const targetSellers = ["Ябко", "iStore", "GRO", "MacLove"];

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

async function run() {
  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage({
    viewport: { width: 1728, height: 2400 },
  });

  await page.goto(hotlineUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

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

  console.log("\n=== RESOLVING REDIRECTS ===");

  for (const card of matchedCards) {
    if (!card.buyButtonLink) continue;

    const finalUrl = await resolveRedirect(browser, card.buyButtonLink.href);

    console.log({
      seller: card.seller,
      hotline: card.buyButtonLink.href,
      finalUrl,
    });
  }

  await browser.close();
}

run().catch(console.error);
