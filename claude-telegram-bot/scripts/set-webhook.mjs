#!/usr/bin/env node

// Run this after deploying to set up the Telegram webhook
// Usage: BOT_TOKEN=xxx WEBHOOK_URL=https://... node scripts/set-webhook.mjs

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN || !WEBHOOK_URL) {
  console.error("Usage: BOT_TOKEN=xxx WEBHOOK_URL=https://... node scripts/set-webhook.mjs");
  process.exit(1);
}

async function setWebhook() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      allowed_updates: ["message"],
      drop_pending_updates: true
    })
  });

  const result = await response.json();
  console.log("Set webhook result:", JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error("Failed to set webhook!");
    process.exit(1);
  }

  // Verify webhook
  const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
  const infoResponse = await fetch(infoUrl);
  const info = await infoResponse.json();
  console.log("\nWebhook info:", JSON.stringify(info, null, 2));
}

setWebhook();
