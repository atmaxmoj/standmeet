// WhatsBehind —— 3 行解释这页背后到底是个啥。设计稿的语义：明确告诉访客
// 这不是 résumé / chatbot demo，是 owner 亲自审 transcript 的对话。

import { useTranslations } from 'next-intl';

interface BehindRow {
  kicker: string;
  label: string;
  body: string;
}

// useRows —— 三行文案从消息目录取。key 一条条显式写出（不拼模板字符串），
// 这样 grep 找得到，将来接第二种语言时也扫得出来。
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
