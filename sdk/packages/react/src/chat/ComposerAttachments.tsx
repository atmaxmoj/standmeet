// ComposerAttachments —— the two symmetric presentations of a long-paste
// attachment:
//   AttachmentChips —— a removable chip hanging above the composer input
//     (before the question is sent).
//   VisitorQuestion —— the you-bubble in the transcript, splitting the
//     composed message back into "question + collapsible pasted block"
//     (after the question is sent), so a JD doesn't turn into a wall of text.
// Pulled out of ChatRoom, for reuse and to trim line count.

'use client';

import { useChatT } from '../i18n.js';

import { attachmentLabel, splitComposedMessage, type Attachment } from './composer-attachments.js';

// AttachmentChips —— attachments collected from long pastes, hanging above
// the input; each shows char count / line count / a first-line preview,
// plus an ✕ to remove it. On submit the attachment's raw text still goes
// into the message (composeMessage).
export function AttachmentChips({ attachments, onRemove }: {
  attachments: readonly Attachment[]; onRemove: (id: string) => void;
}) {
  return attachments.length === 0 ? null : (
    <ul className="smc-attachments" data-testid="composer-attachments">
      {attachments.map((a) => <AttachmentChip key={a.id} a={a} onRemove={onRemove} />)}
    </ul>
  );
}

function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove: (id: string) => void }) {
  const t = useChatT('attachments');
  return (
    <li
      className="smc-attachment"
      data-testid="composer-attachment"
    >
      <span className="smc-attachment-kind">{t('pasted')}</span>
      <span className="smc-attachment-name">{a.label}</span>
      <button
        type="button" onClick={() => onRemove(a.id)} aria-label="remove attachment"
        className="smc-attachment-remove"
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
    <div className="smc-question" data-testid="visitor-question">
      {text !== '' && (
        <p className="smc-question-text">
          {text}
        </p>
      )}
      {pastes.map((c, i) => <PastedBlock key={i} content={c} />)}
    </div>
  );
}

function PastedBlock({ content }: { content: string }) {
  const t = useChatT('attachments');
  return (
    <details className="smc-pasted" data-testid="pasted-block">
      <summary>
        <span className="smc-pasted-kind">{t('pasted')}</span>
        <span className="smc-pasted-name">{attachmentLabel(content)}</span>
      </summary>
      <pre className="reading smc-pasted-body">
        {content}
      </pre>
    </details>
  );
}
