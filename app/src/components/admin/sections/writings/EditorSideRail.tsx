// EditorSideRail —— design 源 admin.js WritingSection side rail (932-982)。
// Tiptap editor 右侧三卡：crosslinks (outgoing/incoming) + keyboard shortcuts。
// publish card 已在 WritingFormFooter 里（PublishToggle + 按钮），不重复。

function countCrosslinks(bodyMD: string): { outgoing: string[]; count: number } {
  const matches = bodyMD.match(/\[\[([^\]]+)\]\]/g) ?? [];
  const slugs = matches.map((m) => m.slice(2, -2));
  return { outgoing: slugs, count: slugs.length };
}

export function EditorSideRail({ bodyMD }: { bodyMD: string }) {
  const xref = countCrosslinks(bodyMD);
  return (
    <div className="flex flex-col gap-4 sticky top-[80px]">
      <CrosslinksCard xref={xref} />
      <KeyboardCard />
    </div>
  );
}

function CrosslinksCard({ xref }: { xref: { outgoing: string[]; count: number } }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-2">cross-links</div>
      <div className="mono text-[10px] tracking-[0.06em] text-(--color-muted) mb-1.5">
        outgoing · {xref.count}
      </div>
      <OutgoingList slugs={xref.outgoing} />
    </div>
  );
}

function OutgoingList({ slugs }: { slugs: readonly string[] }) {
  return slugs.length === 0 ? (
    <div className="mono text-[10.5px] text-(--color-faint)">
      none yet · type [[ to add
    </div>
  ) : (
    <div className="flex flex-col gap-1">
      {slugs.map((s, i) => (
        <div key={`${s}-${i}`} className="mono text-[11px] text-(--color-ink)">[[{s}]]</div>
      ))}
    </div>
  );
}

function KeyboardCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-2">keyboard</div>
      <div className="mono text-[10.5px] text-(--color-muted) tracking-[0.04em] leading-[1.95]">
        <Row keys="/" label="insert block" />
        <Row keys="[[" label="cross-link picker" />
        <Row keys="⌘V" label="paste image inline" />
        <Row keys="⌘K" label="add inline link" />
        <Row keys="esc" label="close menu" />
      </div>
    </div>
  );
}

function Row({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="inline-block min-w-[28px] text-center border border-(--color-rule) rounded-[2px] px-1 py-0.5 text-[9.5px] text-(--color-ink) bg-(--color-paper)">
        {keys}
      </span>
      <span>{label}</span>
    </div>
  );
}
