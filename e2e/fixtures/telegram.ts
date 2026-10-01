// telegram.ts —— the Telegram Bot API stand-in (mock-stack/job-board/telegram.go) that the dev
// stack's im-bridge talks to (TELEGRAM_API_BASE_URL). A spec plays the owner's side of the chat:
// it pushes what the owner types to the bot, and reads what the bot sent.

import type { APIRequestContext } from '@playwright/test';

import { BACKEND, MOCK_BASE } from '@/fixtures/stack';

/** connectTelegram —— the owner connects a bot token as the supplier card does (create →
 *  credentials → connect; the UI lane is covered by im-config-telegram.spec.ts). The dev stack's
 *  bridge then picks it up from /internal/im/config. Returns the connect status. */
export async function connectTelegram(
  request: APIRequestContext, csrf: string, token: string,
): Promise<number> {
  const headers = { 'X-Csrftoken': csrf };
  const created = await request.post(`${BACKEND}/api/admin/suppliers/`, {
    headers, data: { kind: 'credential', seam: 'im' },
  });
  const id = (await created.json() as { id: string }).id;
  await request.post(`${BACKEND}/api/admin/suppliers/${id}/credentials`, { headers, data: { token } });
  const connected = await request.post(`${BACKEND}/api/admin/suppliers/${id}/connect`, { headers, data: {} });
  return connected.status();
}

/** One message the bot sent: the chat, the text, and the URL of each inline-keyboard button. */
export interface SentMessage {
  chat_id: string;
  text: string;
  buttons: string[];
}

/** resetTelegram —— forget every queued update and every sent message. */
export async function resetTelegram(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_BASE}/__mock/tg/reset`);
  if (!res.ok()) throw new Error(`telegram reset: ${res.status()}`);
}

/** ownerTypes —— the person in chat `chatID` sends the bot `text` (a private chat). */
export async function ownerTypes(
  request: APIRequestContext, chatID: number, text: string,
): Promise<void> {
  const res = await request.post(`${MOCK_BASE}/__mock/tg/updates`, {
    data: { chat_id: chatID, text },
  });
  if (!res.ok()) throw new Error(`telegram push update: ${res.status()}`);
}

/** sentTo —— every message the bot sent to `chatID`, oldest first. */
export async function sentTo(request: APIRequestContext, chatID: number): Promise<SentMessage[]> {
  const res = await request.get(`${MOCK_BASE}/__mock/tg/sent?chat_id=${chatID}`);
  if (!res.ok()) throw new Error(`telegram sent: ${res.status()}`);
  return (await res.json() as { messages: SentMessage[] }).messages;
}
