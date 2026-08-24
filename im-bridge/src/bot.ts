// bot.ts —— 把平台那一半接到核心上。
//
// 这一层**只做翻译**：Chat SDK 的 `(thread, message)` → 我们的 `InboundDM`，
// 核心回一段文本 → `thread.post()`。所有跟「这只是那张码的又一个渲染」有关的判断
// 都在 conversation.ts 里，那里不认识任何聊天平台，也因此能被完整测试。
//
// 加一个平台 = 在这里多注册一个适配器，核心一行不动。

import type { InboundDM } from './conversation.js';

/** 从 Chat SDK 的 message 上我们真正要的那几样。留窄一点，免得核心跟着 SDK 的形状飘。 */
export interface IncomingLike {
  text: string;
  author: { userId: string; userName: string; fullName: string; isBot: boolean | 'unknown'; isMe: boolean };
}

/**
 * shouldAnswer —— 这条消息该不该进核心。
 *
 * **两个都必须挡**，而且理由不同：
 *   · `isMe` —— 我们自己发出去的话又被平台回灌（多数平台会）。不挡就是自问自答的死循环。
 *   · `isBot` —— 对面是另一个机器人。两个都不挡的话，两个 bot 能互相刷到限流为止，
 *     而账单和配额记在 owner 头上。
 *
 * `isBot` 可能是 `'unknown'`（平台没说）。**未知按人处理** —— 把真人误挡成机器人，
 * 他会对着一个不回话的窗口干等，而且完全看不出为什么。
 */
export function shouldAnswer(m: IncomingLike): boolean {
  if (m.author.isMe) return false;
  if (m.author.isBot === true) return false;
  return m.text.trim() !== '';
}

/** toInbound —— 平台 message → 核心的入参。名字优先用 fullName，退回 userName。 */
export function toInbound(m: IncomingLike): InboundDM {
  const name = m.author.fullName.trim() !== '' ? m.author.fullName : m.author.userName;
  return { userID: m.author.userId, displayName: name, text: m.text };
}
