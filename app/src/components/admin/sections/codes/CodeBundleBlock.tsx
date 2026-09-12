// CodeBundleBlock — the bundle a code carries, and its contents on demand.
//
// Its own file because CodeCard is at the 350-line cap, and because this is a
// self-contained answer to one question — "what can this code do" — rather than another
// field of the card. `docs/design/plugin/frontend.md` §3 is the whole reason it exists:
// that question used to mean reading three screens.
//
// The bundle's NAME is always visible; its contents are behind a click. An owner
// scanning twenty codes wants the headline, and twenty expanded lists is a screen nobody
// reads.
//
// Nothing renders for a code with no bundle. That is not an empty bundle — it means the
// code is judged by its role, exactly as it always was — and inventing a "no bundle" row
// would imply a choice the owner never made.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { CodeBlockList } from '@/components/admin/sections/codes/CodeBlockList';
import type { CodeView } from '@/lib/admin/use-codes';

export function CodeBundleBlock({ code }: { code: CodeView }) {
  return code.bundle === '' ? null : <Bound code={code} />;
}

function Bound({ code }: { code: CodeView }) {
  const t = useTranslations('adminIntegrations.blocks');
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-(--color-rule)/40 pt-3">
      <button
        type="button"
        data-testid="code-expand"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mono text-[10px] text-(--color-muted) hover:text-(--color-accent)"
      >
        {t('codeBundle', { name: code.bundle })}
      </button>
      {open && <CodeBlockList bundle={code.bundle} />}
    </div>
  );
}
