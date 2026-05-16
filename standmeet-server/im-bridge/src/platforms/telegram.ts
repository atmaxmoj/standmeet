import { Bot, InlineKeyboard, type Context } from "grammy";
import { GatewayClient } from "../gateway/ws-client.js";
import { getSession, setSession, findActiveSession } from "../session-map.js";
import { fetchContentSummary, pathToLabel } from "../content-fetcher.js";
import type { BridgeConfig, ImPlatformConfig } from "../config.js";

const PLATFORM = "telegram";
const SOURCE_PREFIX = "src:";

/**
 * Escape special characters for Telegram MarkdownV2.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Check if the bot is mentioned in a group message via @username entity.
 */
function isBotMentioned(ctx: Context, botUsername: string): boolean {
  const entities = ctx.message?.entities ?? [];
  const text = ctx.message?.text ?? "";
  for (const entity of entities) {
    if (entity.type === "mention") {
      const mentionText = text.slice(entity.offset, entity.offset + entity.length);
      if (mentionText.toLowerCase() === `@${botUsername.toLowerCase()}`) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Strip @bot_username mention from message text.
 */
function stripBotMention(text: string, botUsername: string): string {
  return text.replace(new RegExp(`@${botUsername}\\s*`, "i"), "").trim();
}

export async function startTelegram(
  platformConfig: ImPlatformConfig,
  bridgeConfig: BridgeConfig,
): Promise<void> {
  const token = platformConfig.bot_token;
  if (!token) {
    console.error("[telegram] bot_token not configured, skipping");
    return;
  }

  const bot = new Bot(token);

  // Cache bot username for deep links
  const me = await bot.api.getMe();
  const botUsername = me.username ?? "";
  console.log(`[telegram] Bot @${botUsername} started`);

  // Save bot_username back to Django if not set
  if (!platformConfig.bot_username && me.username) {
    platformConfig.bot_username = me.username;
    saveBotUsername(bridgeConfig, me.username).catch((err) =>
      console.error("[telegram] failed to save bot_username:", err),
    );
  }

  // /start {invite_code} — deep link entry point (only works in private chats)
  bot.command("start", async (ctx) => {
    // /start deep links only work in private chats
    if (ctx.chat?.type !== "private") return;

    const inviteCode = ctx.match?.trim();
    if (!inviteCode) {
      await ctx.reply("Please use a valid invite link or send an invite code (starting with sm\\_).");
      return;
    }

    const chatId = String(ctx.chat.id);
    await connectAndAuth(ctx, chatId, inviteCode, bridgeConfig, botUsername);
  });

  // Handle inline keyboard button clicks
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(SOURCE_PREFIX)) return;

    const path = data.slice(SOURCE_PREFIX.length);

    const summary = await fetchContentSummary(
      bridgeConfig.djangoUrl,
      bridgeConfig.ownerToken,
      path,
    );

    const label = pathToLabel(path);
    await ctx.reply(`*${label}* (${path})\n\n${summary}`);
    await ctx.answerCallbackQuery();
  });

  // Regular messages
  bot.on("message:text", async (ctx) => {
    const chatType = ctx.chat?.type;
    const isPrivate = chatType === "private";
    const isGroup = chatType === "group" || chatType === "supergroup";

    // Only handle private and group chats
    if (!isPrivate && !isGroup) return;

    const chatId = String(ctx.chat.id);
    let text = ctx.message.text.trim();

    // Strip @mention from text
    if (isGroup && botUsername) {
      text = stripBotMention(text, botUsername);
    }

    // Check if message contains an invite code
    const inviteMatch = text.match(/\b(sm_\w+)\b/);

    // In groups, check for invite code (no mention needed) or @mention
    if (isGroup) {
      const mentioned = botUsername ? isBotMentioned(ctx, botUsername) : false;

      if (!inviteMatch && !mentioned) {
        // Not mentioned — log as context for chat history
        const entry = findActiveSession(PLATFORM, chatId);
        if (entry) {
          const authorName = ctx.from?.first_name ?? ctx.from?.username ?? "Unknown";
          entry.client.sendContext(text, authorName);
        }
        return;
      }
    }

    // Connect with invite code if found
    if (inviteMatch) {
      await connectAndAuth(ctx, chatId, inviteMatch[1], bridgeConfig, botUsername);
      return;
    }

    // Find active session
    const entry = findActiveSession(PLATFORM, chatId);
    if (!entry) {
      await ctx.reply("No active session. Send an invite code (sm\\_xxx) to start.");
      return;
    }

    try {
      // Show typing indicator while AI processes
      await ctx.replyWithChatAction("typing");
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);

      try {
        const result = await entry.client.sendMessage(text);
        clearInterval(typingInterval);
        await sendLongMessage(ctx, result.content, result.sources);
      } catch (err) {
        clearInterval(typingInterval);
        throw err;
      }
    } catch (err) {
      console.error("[telegram] sendMessage error:", err);
      await ctx.reply("Something went wrong. Please try again.");
    }
  });

  bot.start();
}

async function connectAndAuth(
  ctx: Context,
  chatId: string,
  inviteCode: string,
  bridgeConfig: BridgeConfig,
  botUsername: string,
): Promise<void> {
  // Check for existing session with this invite code
  const existing = getSession(PLATFORM, chatId, inviteCode);
  if (existing?.client.connected) {
    await ctx.reply("You already have an active session with this invite code.");
    return;
  }

  // Show typing while connecting
  await ctx.replyWithChatAction("typing").catch(() => {});

  const client = new GatewayClient();

  try {
    await client.connect(bridgeConfig.gatewayUrl);
  } catch (err) {
    console.error("[telegram] gateway connect error:", err);
    await ctx.reply("Could not connect to the server. Please try again later.");
    return;
  }

  // Set up greeting handler before auth
  client.onGreeting(async (content) => {
    try {
      await sendLongMessage(ctx, content);
    } catch {
      // ignore send errors for greeting
    }
  });

  const result = await client.authenticate(inviteCode);

  if (!result.success) {
    client.close();
    await ctx.reply(`Authentication failed: ${escapeMarkdownV2(result.error ?? "Unknown error")}`);
    return;
  }

  setSession(PLATFORM, chatId, inviteCode, {
    client,
    sessionId: result.sessionId!,
    inviteCode,
  });

  const label = result.label || inviteCode;
  const webChatUrl = `${bridgeConfig.webUrl}/i/${inviteCode}/${result.sessionId}`;
  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
  const usageHint = isGroup
    ? `Mention me with <code>@${escapeHtml(botUsername)}</code> to chat.`
    : `You can start chatting now.`;
  await ctx.reply(
    `Connected to <b>${escapeHtml(label)}</b>.\n` +
    `Web chat: ${escapeHtml(webChatUrl)}\n\n` +
    usageHint,
    { parse_mode: "HTML" },
  );
}

/**
 * Build InlineKeyboard for source references.
 */
function buildSourceKeyboard(sources: string[]): InlineKeyboard | null {
  if (sources.length === 0) return null;

  const keyboard = new InlineKeyboard();
  for (const path of sources) {
    keyboard.text(pathToLabel(path), `${SOURCE_PREFIX}${path}`).row();
  }
  return keyboard;
}

/**
 * Split long messages (Telegram has a 4096 char limit).
 * Optionally attaches source keyboard to the last chunk.
 */
async function sendLongMessage(
  ctx: Context,
  text: string,
  sources?: string[],
): Promise<void> {
  const MAX_LEN = 4000; // leave margin
  const keyboard = sources?.length ? buildSourceKeyboard(sources) : null;

  if (text.length <= MAX_LEN) {
    await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined);
    return;
  }

  // Split by paragraphs, then by max length
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > MAX_LEN) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    if (isLast && keyboard) {
      await ctx.reply(chunks[i], { reply_markup: keyboard });
    } else {
      await ctx.reply(chunks[i]);
    }
  }
}

async function saveBotUsername(bridgeConfig: BridgeConfig, username: string): Promise<void> {
  const settingsRes = await fetch(`${bridgeConfig.djangoUrl}/api/settings/`, {
    headers: { Authorization: `Bearer ${bridgeConfig.ownerToken}` },
  });
  if (!settingsRes.ok) return;

  const settings = await settingsRes.json();
  const im = settings.im_integrations ?? {};
  im.telegram = { ...im.telegram, bot_username: username };

  await fetch(`${bridgeConfig.djangoUrl}/api/settings/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bridgeConfig.ownerToken}`,
    },
    body: JSON.stringify({ im_integrations: im }),
  });
}
