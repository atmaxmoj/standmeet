// DeckHeader —— "── KICKER  count  [action]" 横条，下方 1px rule。
// 公开页所有 deck（conversation / insights / projects / where / contact）
// 共用，让每个 section 有一致的视觉打开。

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

// DeckCount —— 只有**一条**内容时不印计数。`01` 挂在一个复数标题旁边、下面只有一行，
// 读起来像列表没加载完 —— 而计数回答的是"这里有多少条"，一条的时候它不回答任何问题
// （UX-44）。
function DeckCount({ count }: { count?: number }) {
  return count === undefined || count <= 1 ? null : (
    <span className="mono text-[10px] tracking-[0.14em] text-(--color-faint) tabular-nums ml-1">
      {String(count).padStart(2, '0')}
    </span>
  );
}
