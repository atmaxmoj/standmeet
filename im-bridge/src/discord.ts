// discord.ts —— running the owner's Discord bot from the one thing they typed: its token.
//
// The Chat SDK's Discord adapter wants more than a token; the owner gives only the token (like
// Telegram) and never opens the developer portal for the rest ("你最好让这种部署依赖少点，都在ui里面写",
// owner, 2026-10-01). The bridge asks Discord, with the token, for what it needs:
//   · applicationId —— GET /applications/@me answers with the bot's application.
//   · the Message Content intent —— the adapter connects asking for it, and Discord closes the
//     Gateway (4014) when the application has not turned it on. An application in fewer than 100
//     servers may turn it on itself (PATCH /applications/@me, the "limited" flag), so the bridge
//     does.
//   · publicKey —— only verifies HTTP interactions (Discord calling us). The bridge takes none: it
//     listens on the Gateway, an outbound WebSocket, because a self-hosted instance usually has no
//     public callback URL (the same reason Telegram runs long-polling). So the verifier rejects
//     every HTTP call, which also closes that door.

import { createDiscordAdapter } from '@chat-adapter/discord';

const API = 'https://discord.com/api/v10/applications/@me';

// Application flags: the Message Content intent, approved (verified apps) or limited (< 100 servers).
const MESSAGE_CONTENT = 1 << 18;
export const MESSAGE_CONTENT_LIMITED = 1 << 19;

/** rejectHTTPInteractions —— the webhook verifier: nothing arrives over HTTP here. */
export function rejectHTTPInteractions(): Promise<boolean> {
  return Promise.resolve(false);
}

function discordAdapter(token: string, applicationId: string) {
  return createDiscordAdapter({
    botToken: token,
    applicationId,
    webhookVerifier: rejectHTTPInteractions,
    userName: 'standmeet',
  });
}

export type DiscordAdapter = ReturnType<typeof discordAdapter>;

/**
 * prepareDiscord —— the adapter for this token, or undefined when Discord refuses the token. A
 * refused token skips Discord and says so; it never stops the bridge (Telegram keeps running, and
 * a corrected token restarts the bridge through waitForChange).
 */
export async function prepareDiscord(
  token: string, log: (m: string) => void,
): Promise<DiscordAdapter | undefined> {
  const auth = { Authorization: `Bot ${token}` };
  const res = await fetch(API, { headers: auth }).catch(() => undefined);
  if (res === undefined || !res.ok) {
    log('im-bridge: Discord did not accept the bot token — Discord is skipped. ' +
      'Paste the token again on the Discord card under /admin/suppliers.');
    return undefined;
  }
  const app = (await res.json()) as { id: string; flags?: number };
  await ensureMessageContent(app.flags ?? 0, auth, log);
  return discordAdapter(token, app.id);
}

async function ensureMessageContent(
  flags: number, auth: Record<string, string>, log: (m: string) => void,
): Promise<void> {
  if ((flags & (MESSAGE_CONTENT | MESSAGE_CONTENT_LIMITED)) !== 0) return;
  const res = await fetch(API, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ flags: flags | MESSAGE_CONTENT_LIMITED }),
  }).catch(() => undefined);
  if (res?.ok !== true) {
    log('im-bridge: could not turn on the Message Content intent for this bot — turn it on at ' +
      'discord.com/developers/applications → your app → Bot → Message Content Intent.');
  }
}

// GATEWAY_SPAN_MS —— how long one Gateway session is held before it is renewed. The adapter was
// written for serverless (a listener that lives for a few minutes); a long-running bridge keeps
// renewing it. Renewing daily keeps reconnections rare.
const GATEWAY_SPAN_MS = 24 * 60 * 60 * 1000;

/**
 * listenForever —— hold the Gateway open, renewing it when a session ends. A session that ends
 * with an error (network, a revoked token) is retried after a pause instead of stopping the bridge
 * (the Telegram side keeps running either way).
 */
export async function listenForever(adapter: DiscordAdapter, log: (m: string) => void): Promise<never> {
  for (;;) {
    let session: Promise<unknown> = Promise.resolve();
    await adapter.startGatewayListener(
      { waitUntil: (p: Promise<unknown>) => { session = p; } }, GATEWAY_SPAN_MS,
    );
    try {
      await session;
    } catch (e) {
      log(`im-bridge: discord gateway ended: ${String(e)} — reconnecting in 30s`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}
