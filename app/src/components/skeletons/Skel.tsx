// Skel — a single skeleton block. Every concrete skeleton component is
// composed from this atom; the CSS lives in the globals.css `.skel` class
// (pulse animation + color-mix grey).
// Class derivation moved to lib/state/skel-class.ts to keep this
// component's complexity ≤3.

import { skelClass, type SkelProps } from '@/lib/state/skel-class';

export function Skel(props: SkelProps) {
  return <div aria-hidden className={skelClass(props)} />;
}
