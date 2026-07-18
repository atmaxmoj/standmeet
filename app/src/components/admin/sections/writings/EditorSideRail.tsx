// EditorSideRail —— design 源 admin.js WritingSection side rail。
// Tiptap editor 右侧三卡：crosslinks (outgoing/incoming) + keyboard shortcuts。
// publish card 已在 WritingFormFooter 里（PublishToggle + 按钮），不重复。

'use client';

import { useTranslations } from 'next-intl';

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
  const t = useTranslations('adminCorpus.sideRail');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-2">{t('crosslinks')}</div>
      <div className="mono text-[10px] tracking-[0.06em] text-(--color-muted) mb-1.5">
        {t('outgoing', { count: xref.count })}
      </div>
      <OutgoingList slugs={xref.outgoing} />
    </div>
  );
}

function OutgoingList({ slugs }: { slugs: readonly string[] }) {
  const t = useTranslations('adminCorpus.sideRail');
  return slugs.length === 0 ? (
    <div className="mono text-[10.5px] text-(--color-faint)">
      {t('noneYet')}
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
  const t = useTranslations('adminCorpus.sideRail');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-2">{t('keyboard')}</div>
      <div className="mono text-[10.5px] text-(--color-muted) tracking-[0.04em] leading-[1.95]">
        <Row keys="/" label={t('keyInsertBlock')} />
        <Row keys="[[" label={t('keyCrossLinkPicker')} />
        <Row keys="⌘V" label={t('keyPasteImage')} />
        <Row keys="⌘K" label={t('keyInlineLink')} />
        <Row keys="esc" label={t('keyCloseMenu')} />
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
