import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, "../data/telegram-report.txt");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

function splitMessage(text, maxLength = 4000) {
  if (!text || text.length <= maxLength) {
    return [text];
  }

  const parts = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength);

    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = maxLength;
    }

    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length) {
    parts.push(remaining);
  }

  return parts;
}

async function sendMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  return axios.post(url, {
    chat_id: CHAT_ID,
    text,
  });
}

async function run() {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing in .env");
  }

  if (!CHAT_ID) {
    throw new Error("CHAT_ID is missing in .env");
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(
      "telegram-report.txt not found. Run telegramReport.js first.",
    );
  }

  const reportText = fs.readFileSync(inputPath, "utf-8").trim();

  if (!reportText) {
    throw new Error("telegram-report.txt is empty.");
  }

  const parts = splitMessage(reportText);

  for (let i = 0; i < parts.length; i++) {
    await sendMessage(parts[i]);
    console.log(`Sent part ${i + 1}/${parts.length}`);
  }

  console.log("Telegram send complete.");
}

run().catch((error) => {
  if (error.response?.data) {
    console.error("Telegram send error:", error.response.data);
  } else {
    console.error("Telegram send error:", error.message);
  }
});
