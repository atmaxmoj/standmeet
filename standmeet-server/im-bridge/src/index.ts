import { loadConfig } from "./config.js";
import { startTelegram } from "./platforms/telegram.js";
import { startDiscord } from "./platforms/discord.js";
import { startSlack } from "./platforms/slack.js";

async function main() {
  console.log("[im-bridge] Loading configuration...");

  const config = await loadConfig();

  const { integrations } = config;
  let started = 0;

  if (integrations.telegram?.enabled) {
    console.log("[im-bridge] Starting Telegram bot...");
    try {
      await startTelegram(integrations.telegram, config);
      started++;
    } catch (err) {
      console.error("[im-bridge] Failed to start Telegram:", err);
    }
  }

  if (integrations.discord?.enabled) {
    console.log("[im-bridge] Starting Discord bot...");
    try {
      await startDiscord(integrations.discord, config);
      started++;
    } catch (err) {
      console.error("[im-bridge] Failed to start Discord:", err);
    }
  }

  if (integrations.slack?.enabled) {
    console.log("[im-bridge] Starting Slack bot...");
    try {
      await startSlack(integrations.slack, config);
      started++;
    } catch (err) {
      console.error("[im-bridge] Failed to start Slack:", err);
    }
  }

  if (started === 0) {
    console.log("[im-bridge] No IM platforms enabled. Exiting.");
    process.exit(0);
  }

  console.log(`[im-bridge] ${started} platform(s) running.`);
}

main().catch((err) => {
  console.error("[im-bridge] Fatal error:", err);
  process.exit(1);
});
