// sessions.ts —— 平台用户 id → 他开着的那一场。
//
// 内存实现：桥重启 = 大家重新发一次码。这是**有意的最小版本**，不是偷懒 ——
// 会话的真源在后端（`access_codes` / `conversations`），这里只是一张「谁正在跟我们说话」
// 的便签。便签丢了，重新认一次码就回来了，一条逐字稿都不会少
// （[[事实归产生它的那一方]]：这里不许成为第二份真源）。
//
// 换 Redis 只换这个文件 —— 多实例部署时才需要，那时便签要跨进程共享。

import type { BridgeSession, SessionStore } from './conversation.js';

export function memorySessions(): SessionStore {
  const m = new Map<string, BridgeSession>();
  return {
    get: (userID) => Promise.resolve(m.get(userID)),
    set: (userID, s) => {
      m.set(userID, s);
      return Promise.resolve();
    },
    drop: (userID) => {
      m.delete(userID);
      return Promise.resolve();
    },
  };
}
