// skel-class —— Skel 组件的 class 串拼。从 component 拆到 lib 让
// component 不背"分支推导"复杂度。

export type SkelRound = 'sm' | 'full';

export interface SkelProps {
  h?: string;
  w?: string;
  round?: SkelRound;
}

export function skelClass(p: SkelProps): string {
  const h = p.h ?? 'h-3';
  const w = p.w ?? 'w-full';
  const radius = p.round === 'full' ? 'rounded-full' : 'rounded-sm';
  return `skel ${h} ${w} ${radius}`;
}
