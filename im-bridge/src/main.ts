// main.ts —— 真的把桥跑起来：owner 连了哪个平台，就跑哪个（Telegram、Discord，可以同时）。
//
// **为什么都是出站连接**：这台实例通常在 owner 自己的机器/内网上，**没有公网回调地址**。
// webhook 那条路要求平台能主动打进来，自托管场景下多数人做不到。Telegram 用 `getUpdates`
// 长轮询，Discord 用 Gateway（WebSocket）——都是有网就能收消息。
//
// **配置从实例取，不从 env 取**：bot token 是 owner 在 admin 里配的连接器凭据，
// 跟 mail / calendar 同一类东西。这里只收两个**接线**参数（后端地址、访客入口）。

import { createTelegramAdapter } from '@chat-adapter/telegram';

import { platformsFor, waitForChange, waitForConfig } from './config.js';
import { discordAdapter, listenForever } from './discord.js';
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
  const cfg = await waitForConfig(internalURL, { log: say });
  const platforms = platformsFor(cfg);

  // mode: 'polling' —— **显式指定，不用 auto**。auto 在拿不准时会
  // 「keeping webhook mode」，而这台机器上没有公网回调 ——
  // 那种情况下桥会安静地一条消息都收不到，日志里也不会说它在等一个永远不来的回调。
  const telegram = platforms.includes('telegram')
    ? createTelegramAdapter({ botToken: cfg.telegramToken, mode: 'polling' }) : undefined;
  const discord = platforms.includes('discord') ? discordAdapter(cfg.discordToken) : undefined;
  const chat = startBridge({ adapters: { ...(telegram && { telegram }), ...(discord && { discord }) }, baseURL });

  // **先 initialize 再开始收消息** —— 适配器是被 Chat 实例初始化的，
  // 顺序反了会抛 `Cannot start polling before initialize()`。
  // 这一条编译期看不出来：类型全对，跑起来才炸。
  await chat.initialize();
  say(`im-bridge: ${platforms.join(' + ')}; standmeet=${baseURL}`);
  void telegram?.startPolling();
  if (discord) void listenForever(discord, say);

  // The owner connected another platform, disconnected one, or rotated a token: restart on the
  // new configuration (compose restarts the bridge; restart: unless-stopped).
  await waitForChange(internalURL, cfg);
  say('im-bridge: chat platforms changed — restarting on the new configuration');
  process.exit(0);
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error('im-bridge: stopped', e);
  process.exit(1);
});
