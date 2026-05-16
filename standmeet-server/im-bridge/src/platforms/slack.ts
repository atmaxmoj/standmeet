import pkg from "@slack/bolt";
const { App } = pkg;
import type { SayFn } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { GatewayClient } from "../gateway/ws-client.js";
import { getSession, setSession, findActiveSession } from "../session-map.js";
import { fetchContentSummary, pathToLabel } from "../content-fetcher.js";
import type { BridgeConfig, ImPlatformConfig } from "../config.js";

const PLATFORM = "slack";
const SOURCE_ACTION_PREFIX = "src_click:";

export async function startSlack(
  platformConfig: ImPlatformConfig,
  bridgeConfig: BridgeConfig,
): Promise<void> {
  const botToken = platformConfig.bot_token;
  const appToken = platformConfig.app_token;
  if (!botToken || !appToken) {
    console.error("[slack] bot_token or app_token not configured, skipping");
    return;
  }

  const app = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
  });

  // Get bot user ID for mention detection
  const authResult = await app.client.auth.test({ token: botToken });
  const botUserId = authResult.user_id ?? "";
  console.log(`[slack] Bot user ID: ${botUserId}`);

  // Handle messages (DM + channels)
  app.message(async ({ message, say }) => {
    // Only handle regular user messages (not bot messages, not subtypes)
    if (message.subtype) return;
    if (!("text" in message) || !message.text) return;
    if (!("user" in message) || !message.user) return;

    const channelType = "channel_type" in message ? message.channel_type : undefined;
    const isDM = channelType === "im";
    const isChannel = channelType === "channel" || channelType === "group" || channelType === "mpim";

    // Only handle DMs and channels
    if (!isDM && !isChannel) return;

    // chatId: use channel for both DM and group (Slack channel ID is unique per conversation)
    const chatId = message.channel;
    let text = message.text.trim();

    // Strip @mention from text
    if (isChannel && botUserId) {
      text = stripSlackMention(text, botUserId);
    }

    // Check if message contains an invite code
    const inviteMatch = text.match(/\b(sm_\w+)\b/);

    // In channels, only respond to @mentions or invite codes
    if (isChannel) {
      const isMentioned = botUserId ? message.text!.includes(`<@${botUserId}>`) : false;

      if (!inviteMatch && !isMentioned) {
        // Not mentioned — log as context for chat history
        const entry = findActiveSession(PLATFORM, chatId);
        if (entry) {
          entry.client.sendContext(text, message.user);
        }
        return;
      }
    }

    // Connect with invite code if found
    if (inviteMatch) {
      await connectAndAuth(say, chatId, inviteMatch[1], bridgeConfig, isChannel);
      return;
    }

    // Find active session
    const entry = findActiveSession(PLATFORM, chatId);
    if (!entry) {
      await say("No active session. Send an invite code (`sm_xxx`) to start.");
      return;
    }

    try {
      const result = await entry.client.sendMessage(text);
      await sayWithSources(say, result.content, result.sources);
    } catch (err) {
      console.error("[slack] sendMessage error:", err);
      await say("Something went wrong. Please try again.");
    }
  });

  // Handle source button clicks
  app.action(new RegExp(`^${SOURCE_ACTION_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), async ({ action, ack, respond }) => {
    await ack();

    if (!("action_id" in action)) return;
    const actionId = action.action_id;
    if (!actionId.startsWith(SOURCE_ACTION_PREFIX)) return;

    const path = actionId.slice(SOURCE_ACTION_PREFIX.length);

    const summary = await fetchContentSummary(
      bridgeConfig.djangoUrl,
      bridgeConfig.ownerToken,
      path,
    );

    const label = pathToLabel(path);
    await respond({
      text: `*${label}* (${path})\n\n${summary}`,
      response_type: "ephemeral",
    });
  });

  await app.start();
  console.log("[slack] Bot started in Socket Mode");
}

/**
 * Strip Slack mention format `<@UXXXXX>` from text.
 */
function stripSlackMention(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "").trim();
}

async function connectAndAuth(
  say: SayFn,
  chatId: string,
  inviteCode: string,
  bridgeConfig: BridgeConfig,
  isChannel = false,
): Promise<void> {
  const existing = getSession(PLATFORM, chatId, inviteCode);
  if (existing?.client.connected) {
    await say("You already have an active session with this invite code.");
    return;
  }

  const gwClient = new GatewayClient();

  try {
    await gwClient.connect(bridgeConfig.gatewayUrl);
  } catch (err) {
    console.error("[slack] gateway connect error:", err);
    await say("Could not connect to the server. Please try again later.");
    return;
  }

  gwClient.onGreeting(async (content) => {
    try {
      await say(content);
    } catch {
      // ignore
    }
  });

  const result = await gwClient.authenticate(inviteCode);

  if (!result.success) {
    gwClient.close();
    await say(`Authentication failed: ${result.error ?? "Unknown error"}`);
    return;
  }

  setSession(PLATFORM, chatId, inviteCode, {
    client: gwClient,
    sessionId: result.sessionId!,
    inviteCode,
  });

  const label = result.label || inviteCode;
  const webChatUrl = `${bridgeConfig.webUrl}/i/${inviteCode}/${result.sessionId}`;
  const usageHint = isChannel
    ? `Mention me with \`@StandMeet\` to chat.`
    : `You can start chatting now.`;
  await say(
    `Connected to *${label}*.\n` +
    `Web chat: ${webChatUrl}\n\n` +
    usageHint,
  );
}

/**
 * Build BlockKit actions block for source buttons.
 */
function buildSourceBlocks(sources: string[]): KnownBlock[] {
  // Slack actions block supports up to 25 elements, but keep it reasonable
  const limited = sources.slice(0, 5);
  if (limited.length === 0) return [];

  const elements = limited.map((path) => ({
    type: "button" as const,
    text: {
      type: "plain_text" as const,
      text: pathToLabel(path),
    },
    action_id: `${SOURCE_ACTION_PREFIX}${path}`,
  }));

  return [
    {
      type: "actions" as const,
      elements,
    },
  ];
}

/**
 * Send message with optional source buttons.
 */
async function sayWithSources(
  say: SayFn,
  text: string,
  sources?: string[],
): Promise<void> {
  const blocks = sources?.length ? buildSourceBlocks(sources) : [];

  if (blocks.length === 0) {
    await say(text);
    return;
  }

  await say({
    text, // fallback for notifications
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text,
        },
      },
      ...blocks,
    ],
  });
}
