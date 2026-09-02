// DeckHeader —— the "── KICKER  count  [action]" bar, with a 1px rule below it.
// Shared by every deck on the public page (conversation / insights /
// projects / where / contact) so each section opens with a consistent look.

import type { ReactNode } from 'react';

type Props = {
  kicker: string;
  count?: number;
  action?: ReactNode;
};

export function DeckHeader({ kicker, count, action }: Props) {
  return (
    <div className="flex items-baseline gap-3 mb-8 pb-3 border-b border-(--color-rule)">
      <span className="mono text-(--color-faint) shrink-0">{'──'}</span>
      <span className="mono text-[10.5px] tracking-[0.22em] uppercase text-(--color-ink)">{kicker}</span>
      <DeckCount count={count} />
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// DeckCount —— doesn't print a count when there's only **one** item. A `01`
// next to a plural heading with just one line below it reads like the list
// failed to finish loading — and the count exists to answer "how many are
// here," which isn't a question worth answering for a count of one (UX-44).
function DeckCount({ count }: { count?: number }) {
  return count === undefined || count <= 1 ? null : (
    <span className="mono text-[10px] tracking-[0.14em] text-(--color-faint) tabular-nums ml-1">
      {String(count).padStart(2, '0')}
    </span>
  );
}
