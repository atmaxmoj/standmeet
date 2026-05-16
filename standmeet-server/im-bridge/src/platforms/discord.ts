import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
  type Interaction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { GatewayClient } from "../gateway/ws-client.js";
import { getSession, setSession, findActiveSession } from "../session-map.js";
import { fetchContentSummary, pathToLabel } from "../content-fetcher.js";
import type { BridgeConfig, ImPlatformConfig } from "../config.js";

const PLATFORM = "discord";
const SOURCE_PREFIX = "src:";

export async function startDiscord(
  platformConfig: ImPlatformConfig,
  bridgeConfig: BridgeConfig,
): Promise<void> {
  const token = platformConfig.bot_token;
  if (!token) {
    console.error("[discord] bot_token not configured, skipping");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.Guilds,
    ],
    partials: [Partials.Channel],
  });

  client.on("ready", () => {
    console.log(`[discord] Bot ${client.user?.tag} started`);
  });

  client.on("messageCreate", async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    const isDM = message.channel.isDMBased();
    const isGuild = !!message.guild;

    // Determine chatId: DM → userId, guild → channelId
    const chatId = isDM ? message.author.id : message.channelId;

    // Strip mention prefix from text
    let text = message.content.trim();
    if (isGuild && client.user) {
      text = text.replace(new RegExp(`<@!?${client.user.id}>\\s*`), "").trim();
    }

    // Check if message contains an invite code
    const inviteMatch = text.match(/\b(sm_\w+)\b/);

    // In guild channels, check for @mention or invite code
    if (isGuild) {
      const isMentioned = client.user && message.mentions.has(client.user.id);

      if (!inviteMatch && !isMentioned) {
        // Not mentioned — log as context for chat history
        const entry = findActiveSession(PLATFORM, chatId);
        if (entry) {
          entry.client.sendContext(text, message.author.displayName ?? message.author.username);
        }
        return;
      }
    }

    // Connect with invite code if found
    if (inviteMatch) {
      await connectAndAuth(message, chatId, inviteMatch[1], bridgeConfig);
      return;
    }

    // Find active session
    const entry = findActiveSession(PLATFORM, chatId);
    if (!entry) {
      await message.reply("No active session. Send an invite code (`sm_xxx`) to start.");
      return;
    }

    try {
      // Show typing indicator while AI processes
      if ("sendTyping" in message.channel) await message.channel.sendTyping();
      const typingInterval = setInterval(() => {
        if ("sendTyping" in message.channel) message.channel.sendTyping().catch(() => {});
      }, 8000);

      try {
        const result = await entry.client.sendMessage(text);
        clearInterval(typingInterval);
        await sendLongMessage(message, result.content, result.sources);
      } catch (err) {
        clearInterval(typingInterval);
        throw err;
      }
    } catch (err) {
      console.error("[discord] sendMessage error:", err);
      await message.reply("Something went wrong. Please try again.");
    }
  });

  // Handle button clicks for source references
  client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    if (!customId.startsWith(SOURCE_PREFIX)) return;

    const path = customId.slice(SOURCE_PREFIX.length);

    await interaction.deferReply();

    const summary = await fetchContentSummary(
      bridgeConfig.djangoUrl,
      bridgeConfig.ownerToken,
      path,
    );

    const label = pathToLabel(path);
    await interaction.editReply(`**${label}** (${path})\n\n${summary}`);
  });

  await client.login(token);
}

async function connectAndAuth(
  message: Message,
  chatId: string,
  inviteCode: string,
  bridgeConfig: BridgeConfig,
): Promise<void> {
  const existing = getSession(PLATFORM, chatId, inviteCode);
  if (existing?.client.connected) {
    await message.reply("You already have an active session with this invite code.");
    return;
  }

  // Show typing while connecting
  if ("sendTyping" in message.channel) await message.channel.sendTyping();

  const gwClient = new GatewayClient();

  try {
    await gwClient.connect(bridgeConfig.gatewayUrl);
  } catch (err) {
    console.error("[discord] gateway connect error:", err);
    await message.reply("Could not connect to the server. Please try again later.");
    return;
  }

  gwClient.onGreeting(async (content) => {
    try {
      await sendLongMessage(message, content);
    } catch {
      // ignore
    }
  });

  const result = await gwClient.authenticate(inviteCode);

  if (!result.success) {
    gwClient.close();
    await message.reply(`Authentication failed: ${result.error ?? "Unknown error"}`);
    return;
  }

  setSession(PLATFORM, chatId, inviteCode, {
    client: gwClient,
    sessionId: result.sessionId!,
    inviteCode,
  });

  const label = result.label || inviteCode;
  const webChatUrl = `${bridgeConfig.webUrl}/i/${inviteCode}/${result.sessionId}`;
  const isGuild = !!message.guild;
  const usageHint = isGuild
    ? `Mention me with \`@${message.client.user?.username ?? "StandMeet"}\` to chat.`
    : `You can start chatting now.`;
  await message.reply(
    `Connected to **${label}**.\n` +
    `Web chat: ${webChatUrl}\n\n` +
    usageHint,
  );
}

/**
 * Build ActionRow buttons for source references.
 */
function buildSourceButtons(sources: string[]): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  // Discord ActionRow limit: 5 buttons
  const limited = sources.slice(0, 5);
  if (limited.length === 0) return null;

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  for (const path of limited) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${SOURCE_PREFIX}${path}`)
        .setLabel(pathToLabel(path))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

/**
 * Split long messages (Discord has a 2000 char limit).
 * Optionally attaches source buttons to the last chunk.
 */
async function sendLongMessage(message: Message, text: string, sources?: string[]): Promise<void> {
  const MAX_LEN = 1900;
  const row = sources?.length ? buildSourceButtons(sources) : null;

  if (text.length <= MAX_LEN) {
    const options: { content: string; components?: ActionRowBuilder<MessageActionRowComponentBuilder>[] } = { content: text };
    if (row) options.components = [row];
    await message.reply(options);
    return;
  }

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
    if (isLast && row) {
      await message.reply({ content: chunks[i], components: [row] });
    } else {
      await message.reply(chunks[i]);
    }
  }
}
