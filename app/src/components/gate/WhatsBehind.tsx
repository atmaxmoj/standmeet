// WhatsBehind —— 3 行解释这页背后到底是个啥。设计稿的语义：明确告诉访客
// 这不是 résumé / chatbot demo，是 owner 亲自审 transcript 的对话。

const ROWS = [
  {
    kicker: '01',
    label: 'a chat, not a page',
    body: "There's no résumé to scroll. You ask questions, an AI answers in the owner's voice, grounded only in things they've actually written.",
  },
  {
    kicker: '02',
    label: 'a scoped slice',
    body: 'Each code unlocks a specific slice of the corpus — e.g. interview slice, investor slice, advisor slice. Private topics stay redacted.',
  },
  {
    kicker: '03',
    label: 'a single conversation, on the record',
    body: "The owner sees the transcript afterward. Treat it like a meeting with someone who can't make the time, not like ChatGPT.",
  },
];

export function WhatsBehind() {
  return (
    <ol className="mt-12 space-y-6">
      {ROWS.map((r) => <Row key={r.kicker} row={r} />)}
    </ol>
  );
}

function Row({ row }: { row: (typeof ROWS)[number] }) {
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
