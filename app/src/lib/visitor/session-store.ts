// session-store.ts —— visitor session 全局单源 state（code / visitor name /
// quota / BYOAI flag）。所有 visitor surface (index / blog / wiki / output /
// page) 共享同一份。
//
// 设计跟 docs/design/project/sm-session.js 对齐：
//   - 唯一持久化点 = localStorage key `standmeet-session`
//   - 跨 tab 同步走 `storage` event；同 tab 跨组件走自定义事件
//   - quota.used 客户端单调递增（chat 发言后 +1）；server 是 session 起始
//     时的 source-of-truth（issueSession 响应里给 used / max），后续不在
//     SSE 里 echo（同一 visitor session 单线增长，client 算得准）
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

const STORAGE_KEY = 'standmeet-session';
const CHANGED_EVENT = 'sm-session-changed';

// VisitorSession —— SessionStrip 渲染所需的全部字段。byoai=true 时 code
// 通常为 null、max=0 表示无限。
export interface VisitorSession {
  code: string | null;
  visitor: string | null;
  byoai: boolean;
  byoaiProvider: string;
  label: string | null;
  used: number;
  max: number;
  startedAt: number;
}

interface SessionState {
  session: VisitorSession | null;
  setSession: (s: VisitorSession | null) => void;
  setVisitor: (name: string) => void;
  consume: (n?: number) => void;
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
  consume: (n = 1) => {
    const cur = get().session;
    if (!cur) return;
    const next: VisitorSession = { ...cur, used: cur.used + n };
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

function load(): VisitorSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VisitorSession) : null;
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
