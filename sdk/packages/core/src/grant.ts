// grant.ts —— **访客手里已经有的那份授权**，以及自定义页面据此该给什么。
//
// 一张码可以绑一个自定义页：扫出来看到的不是默认对话，而是那一页。既然如此，
// 那一页上的 agent 就**必须是这张码的 agent** —— 同一份授权、同一个角色、同一套配额、
// 同一份记账。做法不是让每个页面作者自己去 URL 上捞 `?code=`（捞得到也会忘，
// 忘了就静默退回匿名，而屏幕上看不出差别），而是：颁发那一刻浏览器已经存下了这场 session，
// 页面直接**接手**它。页面作者什么都不用做，也没有做错的余地。
//
// 存在哪：`standmeet:visitor-session`，由实例自己的 gate 在颁发时写。同源，所以
// `/p/<slug>` 读得到。这个键名是**协议的一部分**，两边必须是同一个字符串，
// 所以它的定义在这里，app 那一侧引用它。

const SESSION_KEY = 'standmeet:visitor-session';

/** VISITOR_SESSION_STORAGE_KEY —— 已颁发 session 的落点。写的那一侧也用这个常量。 */
export const VISITOR_SESSION_STORAGE_KEY = SESSION_KEY;

// AdoptedSession —— 接手一场已有 session 所需要的全部东西：往哪发（conversation）、
// 凭什么发（token）、以及这一场的 system prompt 怎么拼。
export interface AdoptedSession {
  readonly conversation_id: string;
  readonly session_token: string;
  readonly system_prompt_part_ids?: readonly string[];
  readonly system_prompt_persona?: string;
}

// adoptStoredSession —— 浏览器里有没有一场已经颁发的 session。没有 / 读不动 / 形状不对
// → null，调用方照常自己开一场。
//
// 不做校验之外的任何加工：这里多一层「顺手补个默认值」就等于替 owner 决定了准入
// （[[invented-default-grants-privilege]]）。
export function adoptStoredSession(): AdoptedSession | null {
  const raw = readRaw();
  if (raw === null) return null;
  const conversation = stringField(raw, 'conversation_id');
  const token = stringField(raw, 'session_token');
  if (conversation === '' || token === '') return null;
  return {
    conversation_id: conversation,
    session_token: token,
    system_prompt_part_ids: stringArrayField(raw, 'system_prompt_part_ids'),
    system_prompt_persona: stringField(raw, 'system_prompt_persona'),
  };
}

// hasVisitorGrant —— 这个读者是带着授权来的吗。**页面自己的设置只在没人带授权时才作数**：
// 挂了码，准入全走码；这个判断是那条规则唯一的落点。
export function hasVisitorGrant(): boolean {
  return adoptStoredSession() !== null;
}

// pageAllowsBYOAI —— 这一页允不允许读者自带 key。
//
// 值来自**服务这一次请求时**注入 index.html 的那个 meta（见后端 custom_pages.go）：
// 页面被撤下、设置被改，下一次请求就是新值 —— 页面里不存快照，也没有第二个端点要问。
export function pageAllowsBYOAI(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector('meta[name="standmeet-page-byoai"]');
  return el?.getAttribute('content') === 'true';
}

// byoaiOffered —— 这一页该不该给读者「自带 key」这条路。
// 带着授权来的人不该被问 —— 他手里那份比自带 key 大，而且是 owner 给的。
export function byoaiOffered(): boolean {
  return !hasVisitorGrant() && pageAllowsBYOAI();
}

function readRaw(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringField(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v : '';
}

function stringArrayField(
  raw: Record<string, unknown>, key: string,
): readonly string[] | undefined {
  const v = raw[key];
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}
