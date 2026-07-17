// ComposerAttachments —— 长粘贴附件的两块对称表现:
//   AttachmentChips —— composer 输入框上方挂的可撤 chip(发问前)。
//   VisitorQuestion —— transcript 里 you 气泡,把 composed 消息拆回
//     「问句 + 折叠粘贴块」(发问后),不让一份 JD 变成文字墙。
// 从 ChatRoom 抽出,既复用又压行数。

'use client';

import { useTranslations } from 'next-intl';

import { attachmentLabel, splitComposedMessage, type Attachment } from '@/lib/visitor/composer-attachments';

// AttachmentChips —— 长粘贴收成的附件,挂输入框上方;每枚显字数/行数/首行
// 预览 + 一个 ✕ 撤掉。发问时附件原文照样进消息(composeMessage)。
export function AttachmentChips({ attachments, onRemove }: {
  attachments: readonly Attachment[]; onRemove: (id: string) => void;
}) {
  return attachments.length === 0 ? null : (
    <ul className="flex flex-col gap-1.5 mb-2" data-testid="composer-attachments">
      {attachments.map((a) => <AttachmentChip key={a.id} a={a} onRemove={onRemove} />)}
    </ul>
  );
}

function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove: (id: string) => void }) {
  const t = useTranslations('visitor.composerAttachments');
  return (
    <li
      className="flex items-center gap-3 px-3 py-2 border border-(--color-rule) text-(--color-muted)"
      data-testid="composer-attachment"
    >
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) shrink-0">{t('pasted')}</span>
      <span className="mono text-[11px] truncate min-w-0 flex-1">{a.label}</span>
      <button
        type="button" onClick={() => onRemove(a.id)} aria-label="remove attachment"
        className="mono text-[12px] text-(--color-faint) hover:text-(--color-accent) transition-colors shrink-0"
      >
        {t('remove')}
      </button>
    </li>
  );
}

// VisitorQuestion —— you 气泡。普通问句直接渲;带粘贴附件的(composed 消息)
// 拆成「问句 + 折叠的 pasted 块」,跟 composer 的 chip 对称,避免一面文字墙。
export function VisitorQuestion({ q }: { q: string }) {
  const { text, pastes } = splitComposedMessage(q);
  return (
    <div className="mb-7">
      {text !== '' && (
        <p className="font-serif italic text-[22px] leading-[1.3] font-[380] tracking-[-0.003em]">
          {text}
        </p>
      )}
      {pastes.map((c, i) => <PastedBlock key={i} content={c} />)}
    </div>
  );
}

function PastedBlock({ content }: { content: string }) {
  const t = useTranslations('visitor.composerAttachments');
  return (
    <details className="mt-3 border border-(--color-rule)" data-testid="pasted-block">
      <summary className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) cursor-pointer list-none marker:hidden px-3 py-2 hover:text-(--color-accent) transition-colors flex items-center gap-2">
        <span className="text-(--color-accent)">{t('pasted')}</span>
        <span className="truncate">{attachmentLabel(content)}</span>
      </summary>
      <pre className="reading text-[13px] whitespace-pre-wrap px-3 py-3 border-t border-(--color-rule) max-h-[40vh] overflow-y-auto">
        {content}
      </pre>
    </details>
  );
}
