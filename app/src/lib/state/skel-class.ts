// skel-class —— class string assembly for the Skel component. Split out of
// the component into lib so the component doesn't carry the "branch
// derivation" complexity.

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
