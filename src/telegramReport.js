import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, "../data/results.json");
const outputPath = path.join(__dirname, "../data/telegram-report.txt");

function isValidNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

function formatPrice(value) {
  if (!isValidNumber(value)) return "n/a";
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(value)} грн`;
}

function formatPercent(value) {
  if (!isValidNumber(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDiff(value) {
  if (!isValidNumber(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(value)} грн`;
}

function deltaIcon(value) {
  if (!isValidNumber(value)) return "";
  return value > 0 ? "🔺" : "🔻";
}

function buildTitle(item) {
  const parts = [item.model];
  if (item.storage) parts.push(item.storage);
  if (item.color) parts.push(item.color);
  return parts.join(" | ");
}

function buildTrackedSellersInline(item) {
  if (
    !Array.isArray(item.trackedSellerResults) ||
    item.trackedSellerResults.length === 0
  ) {
    return "n/a";
  }

  const valid = item.trackedSellerResults
    .filter(
      (sellerItem) =>
        sellerItem?.seller && isValidNumber(sellerItem.currentPrice),
    )
    .sort((a, b) => a.currentPrice - b.currentPrice);

  if (!valid.length) return "n/a";

  return valid
    .map(
      (sellerItem) =>
        `${sellerItem.seller}: ${formatPrice(sellerItem.currentPrice)}`,
    )
    .join(" | ");
}

function getOverRrp(items) {
  return items
    .filter(
      (item) =>
        isValidNumber(item.trackedSellerLowPrice) &&
        isValidNumber(item.rrp) &&
        item.trackedSellerLowPrice > item.rrp,
    )
    .sort((a, b) => b.deltaToRrp - a.deltaToRrp);
}

function getBiggestDiscounts(items, limit = 7) {
  return items
    .filter(
      (item) =>
        isValidNumber(item.trackedSellerLowPrice) &&
        isValidNumber(item.deltaToRrpPercent),
    )
    .sort((a, b) => a.deltaToRrpPercent - b.deltaToRrpPercent)
    .slice(0, limit);
}

function getMarketGapAlerts(items, limit = 7) {
  return items
    .map((item) => {
      if (
        !isValidNumber(item.trackedSellerLowPrice) ||
        !isValidNumber(item.marketLowPrice)
      ) {
        return null;
      }

      const gap = Number(
        (item.trackedSellerLowPrice - item.marketLowPrice).toFixed(2),
      );

      const gapPercent = Number(
        (
          ((item.trackedSellerLowPrice - item.marketLowPrice) /
            item.trackedSellerLowPrice) *
          100
        ).toFixed(1),
      );

      return {
        ...item,
        marketGap: gap,
        marketGapPercent: gapPercent,
      };
    })
    .filter(
      (item) => item && item.marketGap > 1000 && item.marketGapPercent >= 5,
    )
    .sort((a, b) => b.marketGap - a.marketGap)
    .slice(0, limit);
}

function getMissingTrackedCoverage(items) {
  return items.filter(
    (item) =>
      !isValidNumber(item.trackedSellerLowPrice) &&
      isValidNumber(item.marketLowPrice),
  );
}

function buildTelegramReport(data) {
  const lines = [];
  const reportDate = data[0]?.date || "n/a";

  const overRrp = getOverRrp(data);
  const biggestDiscounts = getBiggestDiscounts(data);
  const marketGapAlerts = getMarketGapAlerts(data);
  const missingTrackedCoverage = getMissingTrackedCoverage(data);

  lines.push(`<b>Apple Market Monitor</b>`);
  lines.push(`<i>Daily market update</i>`);
  lines.push(`📅 ${reportDate}`);
  lines.push(`📦 SKU: ${data.length}`);

  lines.push("");
  lines.push("<b>📊 Summary</b>");
  lines.push(`🔴 Over RRP: <b>${overRrp.length}</b>`);
  lines.push(`⚠️ Below RRP: <b>${biggestDiscounts.length}</b>`);
  lines.push(`🟠 Market gaps: <b>${marketGapAlerts.length}</b>`);
  lines.push(`⚪ Missing: <b>${missingTrackedCoverage.length}</b>`);
  lines.push("");

  lines.push("<b>🔴 Over RRP</b>");

  if (!overRrp.length) {
    lines.push("Нет позиций выше RRP.");
  } else {
    for (const item of overRrp) {
      lines.push(`• ${buildTitle(item)}`);

      lines.push(
        `  Low: <b>${formatPrice(item.trackedSellerLowPrice)}</b> | RRP: <b>${formatPrice(item.rrp)}</b>`,
      );

      lines.push(
        `  Diff: ${deltaIcon(item.deltaToRrp)} <b>${formatDiff(item.deltaToRrp)} (${formatPercent(item.deltaToRrpPercent)})</b>`,
      );

      lines.push(`  Sellers: ${buildTrackedSellersInline(item)}`);
    }
  }

  lines.push("");
  lines.push("<b>⚠️ Below RRP</b>");
  for (const item of biggestDiscounts) {
    lines.push(`• ${buildTitle(item)}`);
    lines.push(
      `  Low: <b>${formatPrice(item.trackedSellerLowPrice)}</b> | RRP: <b>${formatPrice(item.rrp)}</b>`,
    );

    lines.push(
      `  Diff: ${deltaIcon(item.deltaToRrp)} <b>${formatDiff(item.deltaToRrp)} (${formatPercent(item.deltaToRrpPercent)})</b>`,
    );
  }

  lines.push("");
  lines.push("<b>🟠 Market gaps</b>");
  if (!marketGapAlerts.length) {
    lines.push("Сильных расхождений между Hotline low и tracked sellers нет.");
  } else {
    for (const item of marketGapAlerts) {
      lines.push(`• ${buildTitle(item)}`);
      lines.push(
        `  Low: <b>${formatPrice(item.trackedSellerLowPrice)}</b> | Hotline: <b>${formatPrice(item.marketLowPrice)}</b>`,
      );

      lines.push(
        `  Gap: <b>${formatDiff(item.marketGap)} (${item.marketGapPercent}%)</b>`,
      );
    }
  }

  lines.push("");
  lines.push("<b>⚪ Missing</b>");
  if (!missingTrackedCoverage.length) {
    lines.push("Все SKU покрыты tracked sellers.");
  } else {
    for (const item of missingTrackedCoverage) {
      lines.push(
        `• ${buildTitle(item)} | Hotline low: <b>${formatPrice(item.marketLowPrice)}</b>`,
      );
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

  const report = buildTelegramReport(data);

  fs.writeFileSync(outputPath, report, "utf-8");

  console.log(report);
  console.log(`\nTelegram report saved to: ${outputPath}`);
} catch (error) {
  console.error("Telegram report generation error:", error.message);
}
