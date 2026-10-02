// notify.ts —— the bridge's outbound half (docs/design/notify-rules-and-live-transcript.md, *IM as a
// channel*): the instance sends the owner a card through the bot, and the owner links their chat to
// the instance by sending the bot a pairing code.
//
//   · `/pair CODE` in a private chat → POST <backend>/internal/im/pair; the bot answers either way.
//   · POST :8090/internal/notify {platform, chat_id, text, link, link_label} → the card goes to that
//     chat: the text, and the link as a button (Telegram: an inline-keyboard button).
//
// The notify server listens inside the container network only: compose never publishes its port.

import { createServer, type IncomingMessage, type Server } from 'node:http';

import { Actions, Card, CardText, LinkButton } from 'chat';

/** NOTIFY_PORT —— where the instance reaches the bridge (http://im-bridge:8090). */
export const NOTIFY_PORT = 8090;

const PAIR = /^\/pair\s+([A-Za-z0-9]{4,})\s*$/;

export const PAIRED = 'Linked — StandMeet will send your notifications to this chat.';
export const NOT_PAIRED = 'That code did not work: it may be mistyped, used, or older than 30 minutes. ' +
  'Get a new one in the admin, under notifications.';

/** pairingCode —— the code in a `/pair CODE` message, or null for any other message. */
export function pairingCode(text: string): string | null {
  return PAIR.exec(text.trim())?.[1]?.toUpperCase() ?? null;
}

/** chatOf —— a thread id as platform + chat id. The chat id is everything after the platform:
 *  `telegram:123` has one part, but a Discord thread is `discord:<guild>:<channel>` (a DM's guild is
 *  `@me`), and keeping only the guild part posted every card to `discord:@me`, which reaches nobody. */
export function chatOf(threadID: string): { platform: string; chatID: string } | null {
  const cut = threadID.indexOf(':');
  if (cut <= 0) return null;
  const platform = threadID.slice(0, cut);
  const chatID = threadID.slice(cut + 1);
  return chatID ? { platform, chatID } : null;
}

/** Pairer —— asks the instance to link this chat; true when it did. */
export type Pairer = (threadID: string, code: string) => Promise<boolean>;

export function backendPairer(internalURL: string): Pairer {
  return async (threadID, code) => {
    const chat = chatOf(threadID);
    if (chat === null) return false;
    const res = await fetch(`${internalURL}/internal/im/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, platform: chat.platform, chat_id: chat.chatID }),
    }).catch(() => null);
    if (res === null || !res.ok) return false;
    return ((await res.json()) as { linked?: unknown }).linked === true;
  };
}

/** NotifyRequest —— one card from the instance. */
export interface NotifyRequest {
  platform: string;
  chat_id: string;
  text: string;
  link?: string;
  link_label?: string;
}

/** cardFor —— the text, and the link (when there is one) as a button. */
export function cardFor(n: NotifyRequest) {
  const children = [CardText(n.text)];
  return n.link
    ? Card({ children: [...children, Actions([LinkButton({ url: n.link, label: n.link_label || 'Open' })])] })
    : Card({ children });
}

/** Poster —— posts a card to `<platform>:<chat id>`; throws when the platform refused it. */
export type Poster = (threadID: string, card: ReturnType<typeof cardFor>) => Promise<void>;

/** startNotifyServer —— POST /internal/notify → the card; 400 unreadable, 502 the platform refused. */
export function startNotifyServer(post: Poster, log: (m: string) => void, port = NOTIFY_PORT): Server {
  const server = createServer((req, res) => {
    void handle(req, post, log).then((status) => {
      res.writeHead(status).end();
    });
  });
  server.listen(port);
  return server;
}

async function handle(req: IncomingMessage, post: Poster, log: (m: string) => void): Promise<number> {
  if (req.method !== 'POST' || req.url !== '/internal/notify') return 404;
  const n = await readNotify(req);
  if (n === null) return 400;
  try {
    await post(`${n.platform}:${n.chat_id}`, cardFor(n));
    return 204;
  } catch (e) {
    log(`im-bridge: notify ${n.platform} failed: ${e instanceof Error ? e.message : String(e)}`);
    return 502;
  }
}

async function readNotify(req: IncomingMessage): Promise<NotifyRequest | null> {
  let body = '';
  for await (const chunk of req) body += String(chunk);
  try {
    const n = JSON.parse(body) as Partial<NotifyRequest>;
    return typeof n.platform === 'string' && typeof n.chat_id === 'string' && typeof n.text === 'string'
      ? { platform: n.platform, chat_id: n.chat_id, text: n.text, link: n.link, link_label: n.link_label }
      : null;
  } catch {
    return null;
  }
}
