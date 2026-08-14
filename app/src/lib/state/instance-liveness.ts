// instance-liveness —— 顶栏那颗灯到底在说什么。
//
// F-N-6：`TopBar` 的 `LiveDot` 里没有任何输入 —— dev、prod、后端停机，三种情况长得一模一样。
// 真在 prod 上把 backend 停掉、点侧栏换一节：正文写着这一节加载失败，顶栏还在 `● LIVE`。
// 一个状态灯不接任何状态，它就不是灯，是装饰；而它占的正是「这台机器现在好不好」那个位置。
//
// 判据从哪来：**每一个 admin 请求都经过 `lib/api/admin`**，那里既知道成功也知道失败。
// 所以不新造心跳（多一条轮询就多一份可能跟事实不一致的状态），只把已经发生的事记下来：
//   - 任何一次 2xx  → 这台机器刚刚答过话
//   - 5xx / 网络断 → 它现在不答话（4xx 不算：那是这次请求本身不成立，机器好着呢）
//
// 只有「够不着」才翻灯 —— 把 403 也算进去的话，一次正常的权限拒绝会让整台实例看起来死了。

import { create } from 'zustand';

export type InstanceLiveness = 'live' | 'unreachable';

interface LivenessState {
  liveness: InstanceLiveness;
  set: (v: InstanceLiveness) => void;
}

const useLivenessStore = create<LivenessState>((set) => ({
  liveness: 'live',
  set: (v) => set((s) => (s.liveness === v ? s : { ...s, liveness: v })),
}));

export function useInstanceLiveness(): InstanceLiveness {
  return useLivenessStore((s) => s.liveness);
}

export function markInstanceAnswered(): void {
  useLivenessStore.getState().set('live');
}

// markInstanceUnreachable —— status 0 表示请求根本没到（网络层）。
export function markInstanceUnreachable(status: number): void {
  if (status === 0 || status >= 500) useLivenessStore.getState().set('unreachable');
}
