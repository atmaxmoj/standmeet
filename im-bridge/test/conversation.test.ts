// conversation.test.ts —— 桥的核心：**一条私信 → 这张码的一轮**。
//
// 断的从来不是「IM 能收发消息」，而是「**它凭什么会跟别的面不一样**」——
// 答案永远该是不会。所以每条用例都拿网页那条路当基准：同一份授权、同一套配额、
// 同一句拒绝的话。
//
// 这一层不需要任何聊天平台在场：平台那半边由 Chat SDK 的适配器负责，
// 核心只跟 `@standmeet/sdk-core` 打交道，而它是可以替身的。
//
// ⚠️ 但**替身一定比真平台客气**：消息长度上限、限流、markdown 方言，它一概不管。
// 所以这一组证的是**我们的逻辑**，不是平台行为 —— 后者归真实环境那一趟。

import { describe, expect, it } from 'vitest';

import { ASK_FOR_CODE, handleDirectMessage, type Deps } from '../src/conversation.js';
import { memorySessions } from '../src/sessions.js';

interface Issued { code: string; visitor_name?: string }

/** rig —— 一个假的 StandMeet 客户端 + 一份内存便签，外加这一趟发生了什么的记录。 */
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
  // 这个替身只实现桥用到的那几个方法 —— 断言要的是行为，不是接口完整性。
  const deps = { client, sessions } as unknown as Deps;
  return { deps, issued, asked, sessions };
}

const RAE = { userID: 'tg:4471', displayName: 'Rae' };

describe('一条私信是那张码的又一个渲染', () => {
  it('没带码的第一句话：告诉他下一步，而不是开一场没有授权的会话', async () => {
    const t = rig();
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: 'hey there' });
    expect(reply).toBe(ASK_FOR_CODE);
    // **一次都不许发** —— 这是那道门本身。
    expect(t.issued, 'no code must not open a session').toHaveLength(0);
  });

  it('带了码：开一场，名字跟着进 owner 的账', async () => {
    const t = rig();
    const reply = await handleDirectMessage(t.deps, { ...RAE, text: '/start ROOM-001' });
    expect(t.issued).toEqual([{ code: 'ROOM-001', visitor_name: 'Rae' }]);
    expect(reply).toMatch(/you're in/i);
    // 只有码那一句不该被当成提问 —— 否则他会收到一句对着码本身的回答。
    expect(t.asked, 'a bare code is not a question').toHaveLength(0);
  });

  it('码和问题在同一条消息里：那句问题不许被吞掉', async () => {
    const t = rig({ answer: 'we price by outcome.' });
    const reply = await handleDirectMessage(t.deps,
      { ...RAE, text: 'ROOM-001 how do you price things?' });
    expect(t.issued).toHaveLength(1);
    // 吞掉的话，人得把刚打过的问题再打一遍 —— 而他不知道为什么要重打。
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
    // 这一面没有界面，那句话就是他能拿到的全部。换成「出错了」等于把出路一起拿走。
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
    // 留着死 session 的话，他每问一句都撞同一堵墙，而且看不出该怎么办。
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
