# Apple Price Tracker

Daily Apple price tracking (UA market) from Hotline + selected sellers with Telegram alerts.

## Features

- Track Apple products from Hotline
- Parse selected sellers (iStore, Ябко, MacLove, GRO)
- Compare vs RRP
- Detect market gaps
- Telegram daily alerts
- Category grouping (iPhone / Apple Watch / AirPods)

## Example Telegram Report

Apple Market Monitor
Date: 2026-03-29

🔴 Over RRP
🟢 Biggest discounts
🟠 Market gap alerts

## Project Structure

```
src/
scraper.js - Playwright + Hotline scraping
telegramReport.js - build short Telegram report
sendTelegram.js - send message via Telegram Bot API

config/
products.csv - tracked SKUs

data/
results.json - parsed data
telegram-report.txt - formatted report
```

## Setup

```
Install dependencies:

npm install


Create `.env`:

BOT_TOKEN=your_bot_token
CHAT_ID=your_chat_id


Run full pipeline:

npm run daily
```

## Pipeline

scraper → results.json  
report → telegram-report.txt  
send → Telegram message

## Tech Stack

- Node.js
- Playwright
- Cheerio
- Axios
- Telegram Bot API

## Roadmap

- Daily cron run
- Channel delivery
- Price history
- Charts
- Alert thresholds
- Web dashboard
