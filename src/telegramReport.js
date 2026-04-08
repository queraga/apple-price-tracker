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

function formatReportDate(value) {
  if (!value) return "n/a";

  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return value;

  return `${day}-${month}-${year}`;
}

function formatPrice(value) {
  if (!isValidNumber(value)) return "n/a";
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(value)} UAH`;
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

function getBelowRrpItems(items) {
  return items.filter(
    (item) =>
      isValidNumber(item.trackedSellerLowPrice) &&
      isValidNumber(item.deltaToRrpPercent) &&
      item.deltaToRrpPercent < 0,
  );
}

function buildBelowRrpDisplayItems(iphoneBelowRrp, nonIphoneBelowRrp) {
  const result = [];

  for (const summary of iphoneBelowRrp.summaries) {
    result.push({
      type: "iphone_summary",
      category: "iPhone",
      ...summary,
    });
  }

  for (const item of iphoneBelowRrp.outliers) {
    result.push({
      type: "item",
      ...item,
    });
  }

  for (const item of nonIphoneBelowRrp) {
    result.push({
      type: "item",
      ...item,
    });
  }

  return result;
}

function getLobLabel(category) {
  const normalized = String(category || "")
    .trim()
    .toLowerCase();

  if (normalized === "iphone") return "📱 iPhone";
  if (normalized === "aw") return "⌚ Apple Watch";
  if (normalized === "airpods") return "🎧 AirPods";
  if (normalized === "ipad") return "📲 iPad";
  if (normalized === "mac") return "💻 Mac";

  return `📦 ${category || "Other"}`;
}

function groupItemsByLob(items) {
  const grouped = new Map();

  for (const item of items) {
    const lob = getLobLabel(item.category);

    if (!grouped.has(lob)) {
      grouped.set(lob, []);
    }

    grouped.get(lob).push(item);
  }

  return grouped;
}

function getLobCounts(items) {
  const counts = new Map();

  for (const item of items) {
    const lob = getLobLabel(item.category);
    counts.set(lob, (counts.get(lob) || 0) + 1);
  }

  return counts;
}

function pushGroupedItems(lines, items, renderItem) {
  const grouped = groupItemsByLob(items);

  for (const [lob, lobItems] of grouped.entries()) {
    lines.push("");
    lines.push(`<b>${lob}</b>`);

    for (const item of lobItems) {
      renderItem(item);
    }
  }
}

function groupIphoneBelowRrp(items, threshold = 10) {
  const iphoneItems = items.filter(
    (item) =>
      item.category === "iPhone" &&
      typeof item.model === "string" &&
      item.deltaToRrpPercent < 0,
  );

  const grouped = new Map();

  for (const item of iphoneItems) {
    const key = item.model;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(item);
  }

  const summaries = [];
  const outliers = [];

  for (const [model, groupItems] of grouped.entries()) {
    const normalRangeItems = groupItems.filter(
      (item) =>
        isValidNumber(item.deltaToRrpPercent) &&
        item.deltaToRrpPercent >= -threshold,
    );

    const belowThresholdItems = groupItems.filter(
      (item) =>
        isValidNumber(item.deltaToRrpPercent) &&
        item.deltaToRrpPercent < -threshold,
    );

    if (normalRangeItems.length > 0) {
      const percents = normalRangeItems.map((item) => item.deltaToRrpPercent);
      const minPercent = Math.min(...percents);
      const maxPercent = Math.max(...percents);
      const avgPercent =
        percents.reduce((sum, value) => sum + value, 0) / percents.length;

      summaries.push({
        model,
        count: normalRangeItems.length,
        minPercent: Number(minPercent.toFixed(1)),
        maxPercent: Number(maxPercent.toFixed(1)),
        avgPercent: Number(avgPercent.toFixed(1)),
      });
    }

    outliers.push(...belowThresholdItems);
  }

  summaries.sort((a, b) => a.model.localeCompare(b.model));
  outliers.sort((a, b) => a.deltaToRrpPercent - b.deltaToRrpPercent);

  return { summaries, outliers };
}

const itemSeparator = "--------------------";

function getNonIphoneBelowRrp(items, threshold = -20) {
  return items
    .filter(
      (item) =>
        item.category !== "iPhone" &&
        isValidNumber(item.deltaToRrpPercent) &&
        item.deltaToRrpPercent <= threshold,
    )
    .sort((a, b) => a.deltaToRrpPercent - b.deltaToRrpPercent);
}

function buildTelegramReport(data) {
  const lines = [];
  const reportDate = formatReportDate(data[0]?.date);

  const overRrp = getOverRrp(data);

  const belowRrpItems = getBelowRrpItems(data);
  const iphoneBelowRrp = groupIphoneBelowRrp(data, 10);
  const nonIphoneBelowRrp = getNonIphoneBelowRrp(data, -12);

  const belowRrpDisplayItems = buildBelowRrpDisplayItems(
    iphoneBelowRrp,
    nonIphoneBelowRrp,
  );

  const marketGapAlerts = getMarketGapAlerts(data);
  const missingTrackedCoverage = getMissingTrackedCoverage(data);

  lines.push(`<b>Apple Market Monitor</b>`);
  lines.push(`<i>Daily market update</i>`);
  lines.push(`📅 ${reportDate}`);
  lines.push(`📦 SKU: ${data.length}`);

  lines.push("");
  lines.push("<b>📊 Summary</b>");
  lines.push(`🟢 Over RRP: <b>${overRrp.length}</b>`);

  lines.push(`⚠️ Below RRP: <b>${belowRrpItems.length}</b>`);
  // lines.push(`🟠 Market gaps: <b>${marketGapAlerts.length}</b>`);
  lines.push(`⚪ Missing: <b>${missingTrackedCoverage.length}</b>`);
  lines.push("");

  const lobCounts = getLobCounts(data);

  lines.push("<b>🏷 LOB</b>");
  for (const [lob, count] of lobCounts.entries()) {
    lines.push(`${lob}: <b>${count}</b>`);
  }
  lines.push("");
  lines.push("<b>🟢 Over RRP</b>");

  if (!overRrp.length) {
    lines.push("No SKUs above RRP.");
  } else {
    pushGroupedItems(lines, overRrp, (item) => {
      lines.push(`• ${buildTitle(item)}`);

      lines.push(
        `  Low: <b>${formatPrice(item.trackedSellerLowPrice)}</b> | RRP: <b>${formatPrice(item.rrp)}</b>`,
      );

      lines.push(
        `  Diff: ${deltaIcon(item.deltaToRrp)} <b>${formatDiff(item.deltaToRrp)} (${formatPercent(item.deltaToRrpPercent)})</b>`,
      );

      lines.push(`  Sellers: ${buildTrackedSellersInline(item)}`);
      lines.push(itemSeparator);
    });
  }

  lines.push("");
  lines.push("<b>⚠️ Below RRP</b>");

  if (!belowRrpDisplayItems.length) {
    lines.push("No SKUs below RRP");
  } else {
    const groupedBelow = new Map();

    for (const item of belowRrpDisplayItems) {
      const lob = getLobLabel(item.category);

      if (!groupedBelow.has(lob)) {
        groupedBelow.set(lob, []);
      }

      groupedBelow.get(lob).push(item);
    }

    for (const [lob, lobItems] of groupedBelow.entries()) {
      lines.push("");
      lines.push(`<b>${lob}</b>`);

      for (const item of lobItems) {
        if (item.type === "iphone_summary") {
          lines.push(`• ${item.model} series`);
          lines.push(
            `  Diff range: <b>${item.minPercent}% to ${item.maxPercent}%</b> | Avg: <b>${item.avgPercent}%</b> | SKU: <b>${item.count}</b>`,
          );
          lines.push(itemSeparator);
          continue;
        }

        lines.push(`• ${buildTitle(item)}`);
        lines.push(
          `  Low: <b>${formatPrice(item.trackedSellerLowPrice)}</b> | RRP: <b>${formatPrice(item.rrp)}</b>`,
        );
        lines.push(
          `  Diff: ${deltaIcon(item.deltaToRrp)} <b>${formatDiff(item.deltaToRrp)} (${formatPercent(item.deltaToRrpPercent)})</b>`,
        );
        lines.push(itemSeparator);
      }
    }
  }

  // Temporary pause for rendering Market gaps

  // lines.push("");
  // lines.push("<b>🟠 Market gaps</b>");
  // if (!marketGapAlerts.length) {
  //   lines.push(
  //     "No significant discrepancies between Hotline low and tracked sellers. ✅",
  //   );
  // } else {
  //   for (const item of marketGapAlerts) {
  //     lines.push(`• ${buildTitle(item)}`);

  //     lines.push(
  //       `  Low: <b>${formatPrice(item.trackedSellerLowPrice)}</b> | RRP: <b>${formatPrice(item.rrp)}</b>`,
  //     );

  //     lines.push(
  //       `  Diff: ${deltaIcon(item.deltaToRrp)} <b>${formatDiff(item.deltaToRrp)} (${formatPercent(item.deltaToRrpPercent)})</b>`,
  //     );

  //     lines.push(`  Hotline ref: ${formatPrice(item.marketLowPrice)}`);
  //   }
  // }

  lines.push("");
  lines.push("<b>⚪ Missing</b>");
  if (!missingTrackedCoverage.length) {
    lines.push("All SKUs are covered by tracked sellers. ✅");
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
