// WhatsBehind — 3 lines explaining what's actually behind this page. Per the
// design mockup's intent: tell the visitor plainly that this isn't a
// résumé / chatbot demo, it's a conversation the owner personally reviews the
// transcript of.

import { useTranslations } from 'next-intl';

interface BehindRow {
  kicker: string;
  label: string;
  body: string;
}

// useRows — the three lines of copy come from the message catalog. Each key is
// written out explicitly (not assembled via template strings), so grep can find
// them, and a scan can still find them when a second language is added later.
function useRows(): BehindRow[] {
  const t = useTranslations('gate.whatsBehind');
  return [
    { kicker: '01', label: t('chatLabel'), body: t('chatBody') },
    { kicker: '02', label: t('sliceLabel'), body: t('sliceBody') },
    { kicker: '03', label: t('recordLabel'), body: t('recordBody') },
  ];
}

export function WhatsBehind() {
  const rows = useRows();
  return (
    <ol className="mt-12 space-y-6">
      {rows.map((r) => <Row key={r.kicker} row={r} />)}
    </ol>
  );
}

function Row({ row }: { row: BehindRow }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-5">
      <span className="mono text-[11px] tracking-[0.16em] text-(--color-faint) tabular-nums pt-1.5">
        {row.kicker}
      </span>
      <div>
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-ink) mb-1.5">
          {row.label}
        </div>
        <p className="reading text-(--color-muted) text-[15.5px]">{row.body}</p>
      </div>
    </li>
  );
}
