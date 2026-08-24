// conversation.ts —— 桥的核心：**一条私信进来，怎么变成这张码的一轮对话**。
//
// 不变式跟自定义页、访客 MCP 是同一条：**这只是那张码的又一个渲染**。
// 同一份授权、同一个角色、同一套配额、同一份记账 —— 变的只有读者在哪儿看。
//
// 所以这里没有一行「IM 专用」的准入逻辑：认码走 `issueSession`，一轮走 `streamMessage`，
// 两个都是 `@standmeet/sdk-core` —— **跟自定义页、embed 用的是同一个客户端**。
// 配额、撤销、逐字稿、拒绝时那句给人看的话，全部白拿；
// 哪天产品改了这些语义，桥跟着动，飘不出一个「只在 IM 上」的分支。
//
// 这一层**不认识任何聊天平台**。平台那半边由 Chat SDK 的适配器负责，
// 它给我们的只有三样：谁发的（稳定 id）、说了什么、怎么回给他。

import type { StandMeetClient } from '@standmeet/sdk-core';

/** InboundDM —— 一条进来的私信。字段挑得跟 matterbridge 那份被十几个协议打磨过的一致。 */
export interface InboundDM {
  /** userID —— 平台上那个人的**稳定 id**（Slack `U…` / Telegram 数字 / Discord 雪花）。 */
  userID: string;
  /** displayName —— 平台上的显示名。会成为这张码上的 member 名字。 */
  displayName: string;
  text: string;
}

/** BridgeSession —— 一个平台用户当前开着的那一场。 */
export interface BridgeSession {
  conversationID: string;
  token: string;
  system: string;
}

/** SessionStore —— 平台用户 id → 他那一场。内存实现够跑，换 Redis 只换这一层。 */
export interface SessionStore {
  get(userID: string): Promise<BridgeSession | undefined>;
  set(userID: string, s: BridgeSession): Promise<void>;
  drop(userID: string): Promise<void>;
}

export interface Deps {
  client: StandMeetClient;
  sessions: SessionStore;
}

/** 第一句话没带码时说什么。指下一步，而不是复述「你没带码」。 */
export const ASK_FOR_CODE =
  'Send me your access code to start — it looks like `LABEL-123`. ' +
  'If you scanned a QR or followed a link, the code was in it.';

/**
 * handleDirectMessage —— 一条私信 → 一句回复。**纯函数式的那一层**：
 * 它不发消息，只说该回什么；发是平台那一侧的事。这样它可以被完整测试，
 * 而不需要任何一个聊天平台在场。
 */
export async function handleDirectMessage(
  deps: Deps, dm: InboundDM,
): Promise<string> {
  const open = await deps.sessions.get(dm.userID);
  if (open) return askOn(deps, open, dm);
  return openThenMaybeAsk(deps, dm);
}

/**
 * openThenMaybeAsk —— 还没有会话：先认码开一场。
 *
 * 开成了之后**不急着回一句问候就完事** —— 如果他那条消息除了码还说了别的
 * （「ROOM-001 你们怎么做定价的」），那句问题就该当成第一问，而不是被吞掉让他重打一遍。
 */
async function openThenMaybeAsk(deps: Deps, dm: InboundDM): Promise<string> {
  const { findCode, looksLikeOnlyCode } = await import('./code.js');
  const code = findCode(dm.text);
  if (code === '') return ASK_FOR_CODE;

  let session: BridgeSession;
  try {
    session = await issue(deps, code, dm.displayName);
  } catch (e) {
    // 后端为每一种拒绝都写了一句给人看的话（码不对 / 被撤销 / 名额满了），
    // 那就把那句话原样递过去 —— 这一面没有界面，那句话就是他能拿到的全部。
    return refusalText(e);
  }
  await deps.sessions.set(dm.userID, session);
  if (looksLikeOnlyCode(dm.text)) return greeting(dm.displayName);
  return askOn(deps, session, dm);
}

async function issue(
  deps: Deps, code: string, visitorName: string,
): Promise<BridgeSession> {
  const s = await deps.client.issueSession({
    mode: 'code', code, visitor_name: visitorName,
  });
  return {
    conversationID: s.conversation_id,
    token: s.session_token,
    // system prompt 一场拼一次。不拼 = 空 system，那样答出来的东西跟这个 owner 无关。
    system: await deps.client.composeSystem(s),
  };
}

/**
 * askOn —— 在已开的那一场上问一句，把流收成一段文本。
 *
 * IM 没有「边打字边显示」这回事（至少这一版没有），所以流在这儿收口；
 * 但走的仍是同一条 `streamMessage`，于是同一套配额、同一份记账照旧。
 */
async function askOn(
  deps: Deps, s: BridgeSession, dm: InboundDM,
): Promise<string> {
  let answer = '';
  try {
    for await (const ev of deps.client.streamMessage(
      s.conversationID, s.token, dm.text, s.system,
    )) {
      if (ev.kind === 'token') answer += ev.text;
      if (ev.kind === 'error') return ev.message;
    }
  } catch (e) {
    // 这一场不行了（撤销 / 过期）→ 丢掉它，下一条消息会重新认码。
    // 留着一个死 session 的话，他每问一句都撞同一堵墙，而且看不出该怎么办。
    if (isSessionGone(e)) await deps.sessions.drop(dm.userID);
    return refusalText(e);
  }
  return answer.trim() === '' ? 'I did not get an answer that time. Ask me again?' : answer;
}

function greeting(name: string): string {
  const who = name.trim() === '' ? '' : ` ${name.trim()}`;
  return `You're in${who}. Ask me anything — I answer from this owner's own notes.`;
}

/** isSessionGone —— 401 = 这张票不再有效（撤销 / 过期）。403 是配额，票还在。 */
function isSessionGone(e: unknown): boolean {
  return statusOf(e) === 401;
}

function statusOf(e: unknown): number {
  if (typeof e !== 'object' || e === null || !('status' in e)) return 0;
  return typeof e.status === 'number' ? e.status : 0;
}

/** refusalText —— 后端写给访客的那句话；拿不到才退回一句通用的。 */
function refusalText(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = e.message;
    if (typeof m === 'string' && m.trim() !== '') return m;
  }
  return 'Something went wrong just now. Try again in a moment.';
}
