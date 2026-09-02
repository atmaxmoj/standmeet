// conversation.test.ts —— the bridge's core: **one direct message → one turn of this code**.
//
// What's under test is never "can IM send and receive messages", it's "**what would ever
// justify it being different from any other surface**" — the answer should always be nothing.
// So every case uses the web path as the baseline: the same authorization, the same quota,
// the same refusal wording.
//
// This layer doesn't need any chat platform present: the platform half is the Chat SDK
// adapter's job, the core only talks to `@standmeet/sdk-core`, which can be stood in for.
//
// ⚠️ But **a stand-in is always politer than the real platform**: message length caps,
// rate limits, markdown dialects — it doesn't enforce any of that.
// So this suite proves **our logic**, not platform behavior — that belongs to the real-env pass.

import { describe, expect, it } from 'vitest';

import { ASK_FOR_CODE, handleDirectMessage, type Deps } from '../src/conversation.js';
import { memorySessions } from '../src/sessions.js';

interface Issued { code: string; visitor_name?: string }

/** rig —— a fake StandMeet client + an in-memory sticky note, plus a record of what happened this run. */
function rig(opts: {
  answer?: string;
  issueErr?: unknown;
  turnErr?: unknown;
} = {}) {
  const issued: Issued[] = [];
  const asked: string[] = [];
  const client = {
    issueSession: (input: { code?: string; visitor_name?: string }) => {
      if (opts.issueErr) return Promise.reject(opts.issueErr);
      issued.push({ code: input.code ?? '', visitor_name: input.visitor_name });
      return Promise.resolve({
        conversation_id: 'conv-1', session_token: 'tok-1',
        quota: { max_turns: 0, used_turns: 0, max_members: 0 }, members: [],
      });
    },
    composeSystem: () => Promise.resolve('SYSTEM'),
    // eslint-disable-next-line @typescript-eslint/require-await
    streamMessage: async function* (_c: string, _t: string, content: string) {
      asked.push(content);
      if (opts.turnErr) throw opts.turnErr;
      yield { kind: 'token' as const, text: opts.answer ?? 'the answer' };
    },
  };
  const sessions = memorySessions();
  // This stand-in implements only the few methods the bridge actually uses — the assertions want behavior, not interface completeness.
  const deps = { client, sessions } as unknown as Deps;
  return { deps, issued, asked, sessions };
}

const RAE = { userID: 'tg:4471', displayName: 'Rae' };

describe('一条私信是那张码的又一个渲染', () => {
  it('没带码的第一句话：告诉他下一步，而不是开一场没有授权的会话', async () => {
    const t = rig();
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: 'hey there' });
    expect(reply).toBe(ASK_FOR_CODE);
    // **must not send even once** —— this is the gate itself.
    expect(t.issued, 'no code must not open a session').toHaveLength(0);
  });

  it('带了码：开一场，名字跟着进 owner 的账', async () => {
    const t = rig();
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: '/start ROOM-001' });
    expect(t.issued).toEqual([{ code: 'ROOM-001', visitor_name: 'Rae' }]);
    expect(reply).toMatch(/you're in/i);
    // A message that's only the code should never be treated as a question — otherwise he'd get back an answer aimed at the code itself.
    expect(t.asked, 'a bare code is not a question').toHaveLength(0);
  });

  it('码和问题在同一条消息里：那句问题不许被吞掉', async () => {
    const t = rig({ answer: 'we price by outcome.' });
    const reply = await handleDirectMessage(t.deps,
      { ...RAE, text: 'ROOM-001 how do you price things?' });
    expect(t.issued).toHaveLength(1);
    // If it got swallowed, he'd have to retype the question he just typed — with no idea why he has to.
    expect(t.asked, 'the question rides along with the code')
      .toEqual(['ROOM-001 how do you price things?']);
    expect(reply).toBe('we price by outcome.');
  });

  it('开过之后：每一条消息都是一轮，不再要码', async () => {
    const t = rig({ answer: 'second answer' });
    await handleDirectMessage(t.deps, { ...RAE, text: 'ROOM-001' });
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: 'and then?' });
    expect(t.issued, 'the session is reused, not re-issued').toHaveLength(1);
    expect(t.asked).toEqual(['and then?']);
    expect(reply).toBe('second answer');
  });

  it('码不对：把后端那句话原样递过去', async () => {
    const t = rig({
      issueErr: Object.assign(new Error('no such access code — check it and paste it again'),
        { status: 401 }),
    });
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: 'NOPE-999' });
    // There's no UI on this surface — that sentence is the entirety of what he gets. Swapping it for "something went wrong" also takes away his way out.
    expect(reply).toMatch(/no such access code/i);
  });

  it('配额用完：说那句话，而且**不丢掉会话**（票还有效）', async () => {
    const t = rig({
      turnErr: Object.assign(new Error('this session has reached its turn limit'),
        { status: 403 }),
    });
    await handleDirectMessage(t.deps, { ...RAE, text: 'ROOM-001' });
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: 'one more' });
    expect(reply).toMatch(/turn limit/i);
    expect(await t.sessions.get(RAE.userID), '403 is a quota, not a dead ticket')
      .toBeDefined();
  });

  it('码被撤销：丢掉会话，下一句重新认码', async () => {
    const t = rig({
      turnErr: Object.assign(new Error('this access code was revoked — ask the owner for a new one'),
        { status: 401 }),
    });
    await handleDirectMessage(t.deps, { ...RAE, text: 'ROOM-001' });
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: 'still there?' });
    expect(reply).toMatch(/revoked/i);
    // If the dead session were kept, every question he asks would hit the same wall, with no way to see what to do about it.
    expect(await t.sessions.get(RAE.userID), 'a revoked ticket is dropped')
      .toBeUndefined();
  });

  it('两个人各自一场 —— 会话按平台用户 id 分，不串', async () => {
    const t = rig();
    await handleDirectMessage(t.deps, { ...RAE, text: 'ROOM-001' });
    await handleDirectMessage(t.deps,
      { userID: 'tg:9902', displayName: 'Mo', text: 'ROOM-001' });
    expect(t.issued.map((i) => i.visitor_name), 'two people, two members')
      .toEqual(['Rae', 'Mo']);
  });
});
