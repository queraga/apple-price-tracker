import { chromium } from "playwright";
import { extractSellerPrice } from "./sellerParsers.js";

async function run() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
  });

  const tests = [
    {
      seller: "Ябко",
      finalUrl: "https://jabko.ua/product/apple-iphone-17-256gb-black",
    },
    {
      seller: "MacLove",
      finalUrl: "https://maclove.ua/catalog/198632/198634/86553",
    },
    {
      seller: "iStore",
      finalUrl: "https://www.istore.ua/ua/item/iphone-17-256gb-black/",
    },
  ];

  for (const test of tests) {
    console.log("RUN TEST:", test.seller, test.finalUrl);

    const result = await extractSellerPrice(page, test.seller, test.finalUrl);

    console.log("\n=== SELLER RESULT ===");
    console.dir(result, { depth: null });
  }

  await browser.close();
}

run().catch(console.error);
