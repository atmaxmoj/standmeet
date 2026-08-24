// main.ts —— 真的把桥跑起来。
//
// **为什么是长轮询而不是 webhook**：这台实例通常在 owner 自己的机器/内网上，
// **没有公网回调地址**。webhook 那条路要求平台能主动打进来，自托管场景下多数人做不到。
// Telegram 的 `getUpdates` 是出站连接 —— 有网就能收消息。
//
// **配置从实例取，不从 env 取**：bot token 是 owner 在 admin 里配的连接器凭据，
// 跟 mail / calendar 同一类东西。这里只收两个**接线**参数（后端地址、访客入口）。

import { createTelegramAdapter } from '@chat-adapter/telegram';

import { waitForToken } from './config.js';
import { startBridge } from './index.js';

function wiring(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v.trim() === '' ? fallback : v;
}

// eslint-disable-next-line no-console
const say = (m: string): void => { console.log(m); };

async function main(): Promise<void> {
  const internalURL = wiring('BACKEND_INTERNAL_URL', 'http://backend:8000');
  const baseURL = wiring('STANDMEET_BASE_URL', 'http://app:3000');

  // 没配 IM 不是错误，是「还没配」—— 空转等着，别崩也别刷屏。
  const token = await waitForToken(internalURL, { log: say });

  // mode: 'polling' —— **显式指定，不用 auto**。auto 在拿不准时会
  // 「keeping webhook mode」，而这台机器上没有公网回调 ——
  // 那种情况下桥会安静地一条消息都收不到，日志里也不会说它在等一个永远不来的回调。
  const telegram = createTelegramAdapter({ botToken: token, mode: 'polling' });
  const chat = startBridge({ adapters: { telegram }, baseURL });

  // **先 initialize 再 startPolling** —— 适配器是被 Chat 实例初始化的，
  // 顺序反了会抛 `Cannot start polling before initialize()`。
  // 这一条编译期看不出来：类型全对，跑起来才炸。
  await chat.initialize();
  say(`im-bridge: telegram long-polling; standmeet=${baseURL}`);
  await telegram.startPolling();
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error('im-bridge: stopped', e);
  process.exit(1);
});
