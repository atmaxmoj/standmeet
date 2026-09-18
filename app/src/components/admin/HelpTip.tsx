// HelpTip — a small "?" the owner clicks to read one plain-language line about a control.
// The blocks panel leaned on internal words (block / group / attach) with no explanation; this
// is the explanation, inline, without sending the owner to a doc. Keyboard-focusable button;
// click toggles a themed popover. testids: `help-<id>` (button) and `help-<id>-text` (the line).

'use client';

import { useState } from 'react';

export function HelpTip({ id, text, label }: { id: string; text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        data-testid={`help-${id}`}
        aria-label={label ?? 'help'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border
          border-(--color-muted) text-[10px] leading-none text-(--color-muted)
          hover:border-(--color-ink) hover:text-(--color-ink)
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-(--color-accent)"
      >
        ?
      </button>
      {open ? (
        <span
          role="tooltip"
          data-testid={`help-${id}-text`}
          className="absolute left-0 top-6 sm-z-float-1 w-64 rounded border border-(--color-rule)
            bg-(--color-surface) p-2 text-left text-xs font-normal normal-case leading-snug
            text-(--color-ink) shadow-md"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
