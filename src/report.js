import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, "../data/results.json");
const outputPath = path.join(__dirname, "../data/report.txt");

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(value)} UAH`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return `${value}%`;
}

function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("uk-UA").format(value)} UAH`;
}

function groupByCategory(items) {
  return items.reduce((acc, item) => {
    const category = item.category || "Other";

    if (!acc[category]) {
      acc[category] = [];
    }

    acc[category].push(item);
    return acc;
  }, {});
}

function buildTrackedSellerLine(item) {
  if (
    !Array.isArray(item.trackedSellerResults) ||
    item.trackedSellerResults.length === 0
  ) {
    return "Tracked sellers: n/a";
  }

  const validSellerResults = item.trackedSellerResults.filter(
    (sellerItem) =>
      sellerItem &&
      sellerItem.seller &&
      sellerItem.currentPrice !== null &&
      sellerItem.currentPrice !== undefined &&
      !Number.isNaN(sellerItem.currentPrice),
  );

  if (validSellerResults.length === 0) {
    return "Tracked sellers: n/a";
  }

  const parts = validSellerResults.map((sellerItem) => {
    const sellerName = sellerItem.seller || "Unknown seller";
    const sellerPrice = formatPrice(sellerItem.currentPrice);
    return `${sellerName} (${sellerPrice})`;
  });

  return `Tracked sellers: ${parts.join(", ")}`;
}

function buildReport(data) {
  const lines = [];

  const reportDate = data[0]?.date || "n/a";

  lines.push("Apple Market Monitor v2");
  lines.push(`Date: ${reportDate}`);
  lines.push(`Total SKU: ${data.length}`);
  lines.push("");

  const grouped = groupByCategory(data);

  for (const [category, items] of Object.entries(grouped)) {
    lines.push(`========== ${category} ==========`);
    lines.push("");

    for (const item of items) {
      const titleParts = [item.model];

      if (item.storage) titleParts.push(item.storage);
      if (item.color) titleParts.push(item.color);

      lines.push(titleParts.join(" | "));
      lines.push(`Article: ${item.article}`);
      lines.push(`RRP: ${formatPrice(item.rrp)}`);

      lines.push(
        `Tracked seller low: ${formatPrice(item.trackedSellerLowPrice)}`,
      );
      lines.push(`Hotline market low: ${formatPrice(item.marketLowPrice)}`);
      lines.push(`Final low: ${formatPrice(item.finalLowPrice)}`);

      lines.push(`Delta to RRP: ${formatDelta(item.deltaToRrp)}`);
      lines.push(`Delta to RRP %: ${formatPercent(item.deltaToRrpPercent)}`);
      lines.push(
        `Market offers: ${
          item.marketOfferCount !== null && item.marketOfferCount !== undefined
            ? item.marketOfferCount
            : "n/a"
        }`,
      );
      lines.push(buildTrackedSellerLine(item));

      if (item.error) {
        lines.push(`Error: ${item.error}`);
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

try {
  if (!fs.existsSync(inputPath)) {
    throw new Error("results.json not found. Run scraper.js first.");
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  const data = JSON.parse(raw);

  const report = buildReport(data);

  fs.writeFileSync(outputPath, report, "utf-8");

  console.log(report);
  console.log(`\nReport saved to: ${outputPath}`);
} catch (error) {
  console.error("Report generation error:", error.message);
}
