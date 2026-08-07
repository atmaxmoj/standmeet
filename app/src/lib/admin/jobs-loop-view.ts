// jobs-loop-view —— dashboard 上「JOBS · ACTIVE LOOP」那一格的取值。
//
// 那一格原来一个字都不看状态:`JobsTopMatch()` 不收参数、不读 state、没有分支,永远渲染
// "register sources to start matching";旁边 SHORTLIST 底下那个 `0` 是 JSX 字面量(F-E-2)。
// 于是 owner 在源已经注册好、池子里躺着工作的时候,读到的还是"去注册源"—— 被指使去做一件
// 已经做完的事,而真正缺的那一步(fetch)一次都没被说出来。
//
// 对的那句话产品里本来就有:/admin/listings 在同样的状态下写的是"源有了,去 fetch",还点名了
// 要跑哪个命令。所以这里不是缺文案,是缺一个**看状态的地方**。这个文件就是那个地方。
//
// 词汇也跟着改齐:池子那一列在 /admin/listings 叫 "in pool",这里就不叫 "shortlist"
// (产品里没有 shortlist 这个东西);而排序是 Claude 的活,StandMeet 只是状态持有者,
// 所以这里报的是**池子里最新的一条**,不是一个它算不出来的 "top match"。

import type { AdminListingRow } from '@/lib/admin/use-admin-listings';

// PoolHeadState —— 池子那一栏此刻在说的话。
// loading 和 error 必须跟 "0" 分开:"池子是空的" 是一句关于事实的陈述,而拉挂了的时候
// 事实是不知道。
export type PoolHeadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'noSources' }
  | { kind: 'noFetch' }
  | { kind: 'job'; title: string; company: string; where: string };

export interface JobsLoopInput {
  sourceCount: number;
  listings: readonly AdminListingRow[];
  loading: boolean;
  error: string | null;
}

export function poolHeadState(in_: JobsLoopInput): PoolHeadState {
  if (in_.loading) return { kind: 'loading' };
  if (in_.error !== null) return { kind: 'error' };
  if (in_.sourceCount === 0) return { kind: 'noSources' };
  const top = in_.listings[0];
  if (top === undefined) return { kind: 'noFetch' };
  return { kind: 'job', title: top.title, company: top.company, where: top.location };
}

// headline / hint —— 只有 job 这一支有真数据要拼;其余几支的文案在组件里按 kind 取,
// 因为它们要走 i18n,而 lib 层不碰 next-intl。
export function jobHeadline(state: PoolHeadState): string {
  return state.kind === 'job' ? `${state.title} · ${state.company}` : '';
}

export function jobHint(state: PoolHeadState): string {
  return state.kind === 'job' ? state.where : '';
}

// poolCountLabel —— 池子里有几条。loading/error 各有各的字面:'…' 还在拉、'—' 没拉到。
// 拿 '0' 当占位就是在说"池子是空的",那是一句可能不成立的陈述。
export function poolCountLabel(in_: JobsLoopInput): string {
  return in_.loading ? '…' : in_.error !== null ? '—' : String(in_.listings.length);
}
