function parsePrice(text) {
  if (!text) return null;

  const match = String(text).match(/(\d[\d\s]*)\s*(₴|грн)/i);
  if (!match) return null;

  const normalized = match[1].replace(/\s+/g, "");
  const value = Number(normalized);

  return Number.isNaN(value) ? null : value;
}

function cleanUrl(url) {
  if (!url) return url;
  return url.split("?")[0];
}

const sellerParsers = {
  Jabko: async (page) => {
    await page.waitForTimeout(2500);

    const result = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : null;
      };

      const currentText =
        getText(".product-info__price-new") ||
        getText(".price-new__uah") ||
        getText(".product-info__price-current");

      const oldText =
        getText(".product-info__price-old") || getText(".price-old__uah");

      return {
        currentText,
        oldText,
      };
    });

    return {
      currentPrice: parsePrice(result.currentText),
      oldPrice: parsePrice(result.oldText),
      diffPrice: null,
      raw: result,
    };
  },

  MacLove: async (page) => {
    await page.waitForTimeout(2500);

    const result = await page.evaluate(() => {
      const el =
        document.querySelector(".uah") ||
        document.querySelector(".prices .uah");

      return {
        currentText: el ? el.innerText.trim() : null,
      };
    });

    return {
      currentPrice: parsePrice(result.currentText),
      oldPrice: null,
      diffPrice: null,
      raw: result,
    };
  },

  iStore: async (page) => {
    await page.waitForTimeout(2500);

    const result = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : null;
      };

      return {
        currentText: getText(".product_price"),
        oldText: getText(".discount_price"),
        diffText: getText(".discount_price_diff"),
      };
    });

    return {
      currentPrice: parsePrice(result.currentText),
      oldPrice: parsePrice(result.oldText),
      diffPrice: parsePrice(result.diffText),
      raw: result,
    };
  },
};

export async function extractSellerPrice(page, seller, finalUrl) {
  if (!seller || !finalUrl) {
    throw new Error(
      `extractSellerPrice: expected seller and finalUrl, got seller=${seller}, finalUrl=${finalUrl}`,
    );
  }

  const normalizedSeller = String(seller).toLowerCase();

  let sellerParser = null;

  if (normalizedSeller.includes("ябко")) {
    sellerParser = "Jabko";
  } else if (normalizedSeller.includes("maclove")) {
    sellerParser = "MacLove";
  } else if (normalizedSeller.includes("istore")) {
    sellerParser = "iStore";
  }

  if (!sellerParser || !sellerParsers[sellerParser]) {
    return {
      seller,
      sellerParser: null,
      finalUrl: cleanUrl(finalUrl),
      currentPrice: null,
      oldPrice: null,
      diffPrice: null,
      raw: null,
    };
  }

  await page.goto(finalUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(2000);

  const parsed = await sellerParsers[sellerParser](page);

  return {
    seller,
    sellerParser,
    finalUrl: cleanUrl(page.url()),
    ...parsed,
  };
}
