// wiring.test.ts —— the **wiring** layer: once a DM comes in, do the two gates actually
// take effect, and does a reply actually go out.
//
// Division of labor with conversation.test.ts: that suite tests "is the answer right"
// (platform-agnostic); this suite tests "**is it wired correctly**" — did the things that
// should be blocked get blocked, did the things that should get a reply get one.
// These two can break independently: the core all-green while the handler is attached to
// the wrong event means, on the real platform, nobody answers the DM.

import { createMockAdapter } from '@chat-adapter/tests';
import { Chat } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import { directMessageHandler, startBridge, type ThreadLike } from '../src/index.js';
import { ASK_FOR_CODE, type Deps } from '../src/conversation.js';
import { memorySessions } from '../src/sessions.js';

/**
 * A fake thread that only records "what got replied".
 *
 * It records the `markdown` field specifically — the bridge must go through
 * `{ markdown }`, not a bare string, or the SDK explicitly does no format
 * conversion and readers see a screen full of `**asterisks**`.
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
    // Replying would be a self-answering infinite loop — and it spends the owner's money every turn.
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
    // Without splitting, the platform **rejects the whole message** — readers get
    // nothing at all, while this layer looks perfectly fine.
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
      // Starting up with an empty baseURL would crash the bridge on **the first real
      // message** — by which point a person is already waiting for a reply.
      expect(() => startBridge({ adapters: { mock: createMockAdapter('mock') } }))
        .toThrow(/STANDMEET_BASE_URL/);
    } finally {
      if (saved !== undefined) process.env['STANDMEET_BASE_URL'] = saved;
    }
  });

  it('处理器**注册在 onDirectMessage 上**，不是别的事件', () => {
    // This one deserves its own assertion: the Chat SDK, with no onDirectMessage handler
    // registered, falls back to routing DMs through **mention routing** (documented
    // behavior). In that case a DM would still look like it "works", but it's going
    // through a different path — the core's unit tests all green while the live
    // behavior is wrong.
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
