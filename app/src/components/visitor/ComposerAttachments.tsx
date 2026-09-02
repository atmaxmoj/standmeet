// ComposerAttachments —— the two symmetric presentations of a long-paste
// attachment:
//   AttachmentChips —— a removable chip hanging above the composer input
//     (before the question is sent).
//   VisitorQuestion —— the you-bubble in the transcript, splitting the
//     composed message back into "question + collapsible pasted block"
//     (after the question is sent), so a JD doesn't turn into a wall of text.
// Pulled out of ChatRoom, for reuse and to trim line count.

'use client';

import { useTranslations } from 'next-intl';

import { attachmentLabel, splitComposedMessage, type Attachment } from '@/lib/visitor/composer-attachments';

// AttachmentChips —— attachments collected from long pastes, hanging above
// the input; each shows char count / line count / a first-line preview,
// plus an ✕ to remove it. On submit the attachment's raw text still goes
// into the message (composeMessage).
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

// VisitorQuestion —— the you-bubble. A plain question renders as-is; a
// question with pasted attachments (a composed message) splits into
// "question + collapsible pasted block", symmetric with the composer's
// chip, to avoid a wall of text.
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
