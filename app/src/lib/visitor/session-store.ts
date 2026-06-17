// session-store.ts —— visitor session 全局单源 state（code / visitor name /
// quota / BYOAI flag）。所有 visitor surface (index / blog / wiki / output /
// page) 共享同一份。
//
// 设计跟 docs/design/project/sm-session.js 对齐：
//   - 唯一持久化点 = localStorage key `standmeet-session`
//   - 跨 tab 同步走 `storage` event；同 tab 跨组件走自定义事件
//   - used 不是独立计数器:它派生自这段 conversation 答完的轮数(useChat 从
//     dialogs 数出来 setUsed 进来)。conversation 是唯一源,没有「乐观自增被迟到
//     快照盖回去」的 race。max / 名额 / 名字也都从后端 reconcile。
//   - URL 带 ?code= 时由 use-absorb-code 那侧 issue session 后写入；URL
//     不带则继续用 stored
//
// 注意：这个 store 跟 `standmeet:visitor-session` (use-gate.ts) 是两个不同
// 角色：
//   - use-gate 的 visitor-session 存 session_token + conversation_id +
//     byoai 布尔（是 "chat 鉴权" 凭据）
//   - 这里的 standmeet-session 存 UI 用的展示数据（code / visitor / quota /
//     label / byoaiProvider，是 "session strip 的渲染源"）
//   - 两者由 issueCodeSession 的响应同时填，之后独立读写

import { create } from 'zustand';
import { z } from 'zod';

import { safeJsonString } from '@/lib/api/typed-json';

const STORAGE_KEY = 'standmeet-session';
const CHANGED_EVENT = 'sm-session-changed';

const VisitorSessionSchema = z.object({
  code: z.string().nullable(),
  visitor: z.string().nullable(),
  byoai: z.boolean(),
  byoaiProvider: z.string(),
  label: z.string().nullable(),
  used: z.number(),
  max: z.number(),
  startedAt: z.number(),
  // 名字上限展示用:maxMembers 这张码共几个名字(0=不限)、memberCount 已有几个。
  // 必填 —— 每条 session 响应都带 quota.max_members + members,如实落进来。
  maxMembers: z.number(),
  memberCount: z.number(),
  // #122: email 是进入时填的访客邮箱(可空);约成卡「引用」按钮据此显隐(空 → 不
  // 给引用,只给透传)。ownerCanEmail = owner 已配通 mail connector(否则整张确认卡
  // 不渲染)。老 localStorage blob 没这俩字段 → default 兜底。
  email: z.string().default(''),
  ownerCanEmail: z.boolean().default(false),
});
export type VisitorSession = z.infer<typeof VisitorSessionSchema>;

interface SessionState {
  session: VisitorSession | null;
  setSession: (s: VisitorSession | null) => void;
  setVisitor: (name: string) => void;
  // setUsed —— 后端 member 级权威值同步进来(load / reconcile)。
  setUsed: (n: number) => void;
  // incUsed —— 一轮答成后乐观 +1。多对话下 used 是 member 级,任意 surface 答成
  // 都把同一个共享计数 +1;下次 load 由后端 member 级合计纠正。
  incUsed: () => void;
  clear: () => void;
  hydrate: () => void;
}

// useIsQuotaExhausted —— SessionStrip / AskInput 用：用尽 turn 后 chat
// 入口禁掉、显式提示 "request more"。max=0 表示无限（owner 没设 max_turns）。
export function useIsQuotaExhausted(): boolean {
  const session = useVisitorSessionStore((s) => s.session);
  if (!session) return false;
  if (session.byoai) return false;
  return session.max > 0 && session.used >= session.max;
}

export const useVisitorSessionStore = create<SessionState>((set, get) => ({
  session: null,
  setSession: (s) => {
    persist(s);
    set({ session: s });
  },
  setVisitor: (name) => {
    const cur = get().session;
    if (!cur) return;
    const next: VisitorSession = { ...cur, visitor: name };
    persist(next);
    set({ session: next });
  },
  setUsed: (n) => {
    const cur = get().session;
    if (!cur || cur.used === n) return;
    const next: VisitorSession = { ...cur, used: n };
    persist(next);
    set({ session: next });
  },
  incUsed: () => {
    const cur = get().session;
    if (!cur) return;
    const next: VisitorSession = { ...cur, used: cur.used + 1 };
    persist(next);
    set({ session: next });
  },
  clear: () => {
    persist(null);
    set({ session: null });
  },
  hydrate: () => {
    set({ session: load() });
  },
}));

// peekStoredSession —— 直接同步读 localStorage 里持久化的展示 session(绕开
// zustand hydrate 时序)。dead-session 收口要拿 code 决定回哪条入口,不能等
// store 灌好(那有竞态)。
export function peekStoredSession(): VisitorSession | null {
  return load();
}

function load(): VisitorSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? safeJsonString(raw, VisitorSessionSchema) : null;
  } catch {
    return null;
  }
}

function persist(s: VisitorSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (s === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
    // 同 tab 跨组件订阅；storage event 只跨 tab。
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: s }));
  } catch {
    // localStorage 满 / 不可用 → silent；下一次写入失败不阻塞 chat。
  }
}

// useSyncVisitorSession —— 挂到 visitor 屏，监听 cross-tab storage + 同 tab
// custom event，把 LS 变化喂进 store。同 tab 内 setSession/consume/clear 已
// 经走 set()，这里主要管 cross-tab；为了简洁也兜底监听同 tab 自定义事件。
//
// 必须在 client component 里调；只 mount-once 不依赖任何 prop。
export function bindVisitorSessionSync(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const hydrate = useVisitorSessionStore.getState().hydrate;
  hydrate();
  const onChange = () => hydrate();
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
