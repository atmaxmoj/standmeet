// ModalShell — shared overlay + close behavior.
//
// **Renders into body (portal), not left inside the calling subtree.**
// `position: fixed` isn't simply anchored to "the viewport": any ancestor with
// transform / filter / backdrop-filter / contain silently switches the anchor to
// itself — and nothing in the code says so anywhere. So "what does this overlay
// actually cover" could only be answered by trial and error, which the owner's
// standard forbids (either read logs, or the architecture must be legible at a
// glance). Once portaled to body, the ancestor chain is just <body>, so the anchor
// is always the viewport — this question **no longer needs asking**.
// Stacking order is likewise already captured in the --z-* scale; together, which
// modal sits on top of what is a fact you can read, not one you have to guess.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cssVars } from '@/lib/ui/css-vars';

type Props = {
  onClose: () => void;
  kicker?: string;
  title: string;
  maxWidth?: number;
  children: ReactNode;
};

export function ModalShell(props: Props) {
  // mounted — there's no document during SSR; only portal after mount. The modal
  // doesn't render on the first frame, but a modal only ever appears after user
  // interaction anyway, so this doesn't affect the first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(<ModalBody {...props} />, document.body) : null;
}

function ModalBody({ onClose, kicker, title, maxWidth = 540, children }: Props) {
  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 sm-z-modal flex items-center justify-center bg-[var(--sm-scrim)] fadein p-4"
    >
      {/* Width goes through `style`, not a computed class like
          `[--max-w:${'${maxWidth}'}px]`. Tailwind **scans source at build time** and
          can't see a concatenated class — that string lands in the HTML but generates
          zero CSS rules, so `.sm-max-w` always falls back to `100%`: **every modal
          renders full width, maxWidth never took effect**. Same failure shape as the
          overlay's shorthand form, and just as silent (see [[names-that-lie]]).
          Dynamic values must go through style — that's real inline CSS, bypassing
          any scanner. */}
      <div
        onClick={stop}
        // eslint-disable-next-line no-restricted-syntax -- maxWidth is a runtime prop; only style can carry a runtime value, a class-name form would generate zero CSS
        style={cssVars({ '--max-w': `${maxWidth}px` })}
        className="flex flex-col w-full max-h-[85vh] overflow-hidden bg-(--color-paper) border border-(--color-rule) rounded-sm rise crosshair sm-max-w"
      >
        <span className="ch-tl" /><span className="ch-br" />
        <ModalHeader kicker={kicker} title={title} onClose={onClose} />
        {/* Frame is fixed, only this area scrolls — header/close always stay pinned */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalHeader({
  kicker, title, onClose,
}: { kicker?: string; title: string; onClose: () => void }) {
  const t = useTranslations('adminShell.modal');
  return (
    <div className="shrink-0 flex items-baseline justify-between px-7 py-5 border-b border-(--color-rule)">
      <ModalTitle kicker={kicker} title={title} />
      <button
        type="button"
        onClick={onClose}
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        {t('close')}
      </button>
    </div>
  );
}

function ModalTitle({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <div>
      {kicker ? <Kicker text={kicker} /> : null}
      <div className="font-serif text-(--color-ink) text-[22px]">{title}</div>
    </div>
  );
}

function Kicker({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1">
      {text}
    </div>
  );
}
