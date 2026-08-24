// wiring.test.ts —— **接线**这一层：私信进来之后，那两道门有没有生效、回复有没有真发出去。
//
// 跟 conversation.test.ts 的分工：那一组测「答得对不对」（不涉及平台），
// 这一组测「**接对了没有**」—— 该挡的挡没挡住、该回的回了没有。
// 这两件事会各自独立地坏：核心全绿而处理器挂错事件，真平台上就是私信没人接。

import { createMockAdapter } from '@chat-adapter/tests';
import { Chat } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import { directMessageHandler, startBridge, type ThreadLike } from '../src/index.js';
import { ASK_FOR_CODE, type Deps } from '../src/conversation.js';
import { memorySessions } from '../src/sessions.js';

/**
 * 一个只记录「回了什么」的假 thread。
 *
 * 记的是 `markdown` 那个字段 —— 桥必须走 `{ markdown }` 而不是裸字符串，
 * 否则 SDK 明说不做格式转换，读者会看到满屏 `**星号**`。
 */
function fakeThread(): ThreadLike & { posted: string[] } {
  const posted: string[] = [];
  return {
    posted,
    post: (m: { markdown: string }) => { posted.push(m.markdown); return Promise.resolve(); },
  };
}

function deps(answer = 'answered'): Deps {
  const client = {
    issueSession: () => Promise.resolve({
      conversation_id: 'c', session_token: 't',
      quota: { max_turns: 0, used_turns: 0, max_members: 0 }, members: [],
    }),
    composeSystem: () => Promise.resolve('SYS'),
    // eslint-disable-next-line @typescript-eslint/require-await
    streamMessage: async function* () { yield { kind: 'token' as const, text: answer }; },
  };
  return { client, sessions: memorySessions() } as unknown as Deps;
}

function author(over: Record<string, unknown> = {}) {
  return {
    text: 'hello',
    author: {
      userId: 'u1', userName: 'rae', fullName: 'Rae',
      isBot: false, isMe: false, ...over,
    },
  };
}

describe('接线：处理器做的事', () => {
  it('真人的私信：回一句出去', async () => {
    const t = fakeThread();
    await directMessageHandler(deps())(t, author());
    expect(t.posted, 'a human gets an answer').toEqual([ASK_FOR_CODE]);
  });

  it('**我们自己的回声：一个字都不发**', async () => {
    const t = fakeThread();
    await directMessageHandler(deps())(t, author({ isMe: true }));
    // 发了就是自问自答的死循环 —— 而且每一轮都花 owner 的钱。
    expect(t.posted, 'our own echo must not be answered').toEqual([]);
  });

  it('**别的机器人：一个字都不发**', async () => {
    const t = fakeThread();
    await directMessageHandler(deps())(t, author({ isBot: true }));
    expect(t.posted, 'another bot must not be answered').toEqual([]);
  });

  it('**长答案发成多条**，每条都在平台上限之内', async () => {
    const long = Array.from({ length: 60 }, (_, i) =>
      `Paragraph ${i} — the owner writes at length about this.`).join('\n\n');
    const t = fakeThread();
    await directMessageHandler(deps(long))(t, { ...author(), text: 'ROOM-001 tell me' });
    // 不切的话平台**整条拒收** —— 读者什么都收不到，而这一层看起来一切正常。
    expect(t.posted.length, 'a long answer goes out as several messages')
      .toBeGreaterThan(1);
    for (const p of t.posted) expect(p.length).toBeLessThanOrEqual(1900);
  });

  it('带码的私信：回的是进场那句，不是要码那句', async () => {
    const t = fakeThread();
    await directMessageHandler(deps())(t, { ...author(), text: 'ROOM-001' });
    expect(t.posted[0], 'a code opens the session').toMatch(/you're in/i);
  });
});

describe('接线：起桥', () => {
  it('缺配置就当场停，而不是带着半个配置跑起来', () => {
    const saved = process.env['STANDMEET_BASE_URL'];
    delete process.env['STANDMEET_BASE_URL'];
    try {
      // 带着空 baseURL 跑起来的话，桥会在**第一条真消息**上炸 —— 那时人已经在等回复了。
      expect(() => startBridge({ adapters: { mock: createMockAdapter('mock') } }))
        .toThrow(/STANDMEET_BASE_URL/);
    } finally {
      if (saved !== undefined) process.env['STANDMEET_BASE_URL'] = saved;
    }
  });

  it('处理器**注册在 onDirectMessage 上**，不是别的事件', () => {
    // 这一条值得单独断：Chat SDK 在没有 onDirectMessage 处理器时会把私信**退回
    // mention 路由**（它文档里写明的）。那种情况下私信看起来照样"能用"，
    // 但走的是另一条路 —— 核心的单测全绿，而线上行为是错的。
    const spy = vi.spyOn(Chat.prototype, 'onDirectMessage');
    try {
      startBridge({
        adapters: { mock: createMockAdapter('mock') },
        baseURL: 'http://localhost:8000',
      });
      expect(spy, 'the DM handler must be registered on onDirectMessage')
        .toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
