// discord.ts —— running the owner's Discord bot from the one thing they typed: its token.
//
// The Chat SDK's Discord adapter wants three settings; the owner gives one (like Telegram).
//   · applicationId —— a bot token's first part is the base64 of the bot's user id, and a bot's
//     user id is its application's id. Read it from the token instead of asking again.
//   · publicKey —— only verifies HTTP interactions (Discord calling us). The bridge takes none: it
//     listens on the Gateway, an outbound WebSocket, because a self-hosted instance usually has no
//     public callback URL (the same reason Telegram runs long-polling). So the verifier rejects
//     every HTTP call, which also closes that door.

import { createDiscordAdapter } from '@chat-adapter/discord';

/** applicationIdFromToken —— the id encoded in a bot token's first part; '' when it isn't one. */
export function applicationIdFromToken(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] === undefined) return '';
  const id = Buffer.from(parts[0], 'base64').toString('utf8');
  return /^\d{15,22}$/.test(id) ? id : '';
}

/** rejectHTTPInteractions —— the webhook verifier: nothing arrives over HTTP here. */
export function rejectHTTPInteractions(): Promise<boolean> {
  return Promise.resolve(false);
}

export function discordAdapter(token: string) {
  return createDiscordAdapter({
    botToken: token,
    applicationId: applicationIdFromToken(token),
    webhookVerifier: rejectHTTPInteractions,
    userName: 'standmeet',
  });
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
export async function listenForever(
  adapter: ReturnType<typeof discordAdapter>, log: (m: string) => void,
): Promise<never> {
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
