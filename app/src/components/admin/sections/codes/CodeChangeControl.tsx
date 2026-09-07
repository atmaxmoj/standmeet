// CodeChangeControl — rotate a code's STRING (leak recovery), from the code card. Split out of
// CodeCard.tsx to keep that file under its line budget.
//
// Rotating a code is destructive to what's already out in the world, so it goes through a warning
// modal first (owner: "改的时候要有 modal warning … 你发出去的那些 resume、embed 等等就都会失效，你确定么").
// The id is unchanged, so embeds + past applications (keyed by id) survive; only the old literal
// string dies, and live sessions on the code are cleared.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useAction } from '@/lib/ui/use-action';
import { useCodes, type CodeView } from '@/lib/admin/use-codes';

// ChangeCodeBtn — only for a live code; opens the warning modal.
export function ChangeCodeBtn({ code }: { code: CodeView }) {
  const t = useTranslations('adminAccess');
  const [open, setOpen] = useState(false);
  return code.status === 'active' ? (
    <>
      <button
        type="button" data-testid={`code-change-${code.code}`} onClick={() => setOpen(true)}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
      >
        {t('codeCard.changeCode')}
      </button>
      {open && <ChangeCodeModal code={code} onClose={() => setOpen(false)} />}
    </>
  ) : null;
}

// ChangeCodeModal — warns what a rotation breaks (already-sent résumé PDFs/QRs, shared ?code= links,
// live sessions) before confirming. The new string defaults to the current one; confirming rotates.
function ChangeCodeModal({ code, onClose }: { code: CodeView; onClose: () => void }) {
  const t = useTranslations('adminAccess');
  const { rotateCode } = useCodes();
  const run = useAction();
  const [next, setNext] = useState(code.code);
  const confirm = (): void => {
    const v = next.trim();
    (v === '' || v === code.code)
      ? onClose()
      : void run(async () => { await rotateCode(code.id, v); onClose(); },
        { success: t('codeCard.changeCodeDone', { code: v }) });
  };
  return (
    <div className="sm-fadein sm-composer-confirm-overlay" onClick={onClose}>
      <div className="sm-composer-confirm-card sm-rise" onClick={(e) => e.stopPropagation()} data-testid="code-change-modal">
        <div className="sm-smallcaps">{t('codeCard.changeCodeTitle')}</div>
        <p className="sm-reading text-(--color-muted) text-[14px] mt-2">{t('codeCard.changeCodeWarn')}</p>
        <input
          value={next} onChange={(e) => setNext(e.target.value)} data-testid="code-change-input"
          aria-label="new code" className="sm-field-input sm-mono mt-3 w-full"
        />
        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="sm-btn sm-btn-ghost" data-testid="code-change-cancel">{t('codeCard.changeCodeCancel')}</button>
          <button type="button" onClick={confirm} className="sm-btn sm-btn-accent" data-testid="code-change-confirm">{t('codeCard.changeCodeConfirm')}</button>
        </div>
      </div>
    </div>
  );
}
