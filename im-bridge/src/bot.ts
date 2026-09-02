// bot.ts —— wires the platform half up to the core.
//
// This layer **only translates**: the Chat SDK's `(thread, message)` →
// our `InboundDM`, the core's reply text → `thread.post()`. Every judgment
// about "this is just another rendering of the same code" lives in
// conversation.ts, which doesn't know any chat platform exists, and can
// therefore be fully tested.
//
// Adding a platform = register one more adapter here; the core doesn't change.

import type { InboundDM } from './conversation.js';

/** The handful of fields we actually need off a Chat SDK message. Kept narrow so the core doesn't drift with the SDK's shape. */
export interface IncomingLike {
  text: string;
  author: { userId: string; userName: string; fullName: string; isBot: boolean | 'unknown'; isMe: boolean };
}

/**
 * shouldAnswer —— whether this message should reach the core.
 *
 * **Both checks are required**, and for different reasons:
 *   · `isMe` — our own outgoing message echoed back by the platform (most
 *     platforms do this). Not blocking it is a self-answering infinite loop.
 *   · `isBot` — the other side is another bot. If neither side blocks the
 *     other, two bots can hammer each other until rate-limited, and the
 *     bill and quota land on the owner.
 *
 * `isBot` can be `'unknown'` (the platform didn't say). **Unknown is treated
 * as human** — mistakenly blocking a real person leaves them staring at a
 * window that never answers, with no way to tell why.
 */
export function shouldAnswer(m: IncomingLike): boolean {
  if (m.author.isMe) return false;
  if (m.author.isBot === true) return false;
  return m.text.trim() !== '';
}

/** toInbound —— platform message → the core's input. Prefers fullName for the name, falls back to userName. */
export function toInbound(m: IncomingLike): InboundDM {
  const name = m.author.fullName.trim() !== '' ? m.author.fullName : m.author.userName;
  return { userID: m.author.userId, displayName: name, text: m.text };
}
