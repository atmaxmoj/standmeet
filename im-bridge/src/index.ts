// index.ts —— 装配。把 Chat SDK 的适配器、我们的 StandMeet 客户端、和核心接到一起。
//
// 这个文件**只做接线**，没有判断 —— 判断全在 conversation.ts（认码、开会话、配额、撤销）
// 和 bot.ts（谁该被回答）。那两个都不认识任何聊天平台，所以都能被完整测试；
// 这里剩下的东西少到「看一眼就知道对不对」。
//
// 加一个平台：在 adapters 里多一行，其余不动。

import { Chat } from 'chat';
import { createMemoryState } from '@chat-adapter/state-memory';
import { createClient } from '@standmeet/sdk-core';

import { shouldAnswer, toInbound, type IncomingLike } from './bot.js';
import { chunkForChat } from './chunk.js';
import { handleDirectMessage, type Deps } from './conversation.js';
import { memorySessions } from './sessions.js';

/** env —— 少一个必需的配置就**当场停**，不要带着半个配置跑起来然后在第一条消息上炸。 */
function env(key: string): string {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') {
    throw new Error(`im-bridge: ${key} is required`);
  }
  return v;
}

export interface BridgeOptions {
  /** adapters —— Chat SDK 的平台适配器。空 = 起不来（没有平台就没有桥）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapters: Record<string, any>;
  /** baseURL —— 这台 StandMeet 实例。桥是它的一个**外部访客客户端**，不是它的一部分。 */
  baseURL?: string;
  /** userName —— 这个 bot 在平台上的名字。 */
  userName?: string;
}

/**
 * startBridge —— 起桥。返回那个 Chat 实例（调用方负责监听 HTTP / 启动长轮询）。
 */
export function startBridge(opts: BridgeOptions): Chat {
  const deps: Deps = {
    client: createClient({ baseURL: opts.baseURL ?? env('STANDMEET_BASE_URL') }),
    sessions: memorySessions(),
  };

  // userName —— 平台上这个 bot 叫什么（SDK 用它判断「有没有被 @ 到」之类）。
  // state —— Chat SDK 自己的线程状态。**内存版**：跟 sessions.ts 同一个理由，
  // 真源在后端，这里只是便签；多实例部署时换 @chat-adapter/state-redis。
  const chat = new Chat({
    userName: opts.userName ?? 'standmeet',
    adapters: opts.adapters,
    state: createMemoryState(),
  });

  chat.onDirectMessage(directMessageHandler(deps));

  return chat;
}

/** ThreadLike —— 处理器回话时用到的那一点点。留窄是为了这一层能脱离 SDK 被测。 */
export interface ThreadLike {
  post(message: { markdown: string }): Promise<unknown>;
}

/**
 * directMessageHandler —— 收到私信之后做什么。**导出是为了它能被直接测**：
 * 「处理器挂在哪个事件上」和「处理器做得对不对」是两件会各自独立坏掉的事，
 * 而后者如果只能通过起一个真 Chat 实例来验，就只会被验得很浅。
 */
export function directMessageHandler(deps: Deps) {
  return async (thread: ThreadLike, message: unknown): Promise<void> => {
    // 两道门在核心之前：我们自己的回声、别的机器人。见 bot.ts 里为什么两个都要挡。
    const incoming = message as IncomingLike;
    if (!shouldAnswer(incoming)) return;
    const reply = await handleDirectMessage(deps, toInbound(incoming));
    // **两件事都不能省**：
    //   · `{ markdown }` —— 传裸字符串的话 SDK 明说「不做任何格式转换」，
    //     而我们的答案是 markdown，读者会看到满屏 `**星号**`（跟 F-P-1 同一族）。
    //   · 切分 —— Telegram 4096 / Discord 2000，超了是**整条拒收**，不是截断。
    for (const part of chunkForChat(reply)) {
      await thread.post({ markdown: part });
    }
  };
}
