// CodeBundleBlock — the group of blocks a code carries: pick / switch / clear it, and read its
// contents on demand.
//
// Its own file because CodeCard is at the 350-line cap, and because this is a self-contained
// answer to one question — "what can this code do" — rather than another field of the card.
// `docs/design/plugin/frontend.md` §3 is the whole reason it exists: that question used to mean
// reading three screens.
//
// The picker renders for EVERY code, bound or not. A group assembled after the code was issued
// has to reach it somehow, and revoke-and-reissue loses the code string; so the code card is the
// place to attach one after the fact (`blocks-admin-coverage.md` G1). "None" is a real choice —
// the code is judged by its role, as every code issued before groups existed still is.
//
// The group's contents are behind a click: an owner scanning twenty codes wants the headline,
// and twenty expanded lists is a screen nobody reads.

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { HelpTip } from '@/components/admin/HelpTip';
import { CodeBlockList } from '@/components/admin/sections/codes/CodeBlockList';
import { SelectField } from '@/components/atoms/SelectField';
import { useBundles } from '@/lib/admin/use-bundles';
import { useCodes } from '@/lib/admin/use-codes';
import type { CodeView } from '@/lib/admin/use-codes';

export function CodeBundleBlock({ code }: { code: CodeView }) {
  const t = useTranslations('adminIntegrations.blocks');
  const { bundles, ensureLoaded } = useBundles();
  const { setBundle } = useCodes();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return (
    <div className="mt-4 border-t border-(--color-rule)/40 pt-3">
      <label className="block">
        <span className="mono text-[10px] tracking-[0.08em] uppercase text-(--color-muted)">
          {t('codeGroupLabel')}
          {/* id="attach-existing", not "attach": CreateCodeFields already ships a help-attach on
              the create form, and two `help-attach` on one page is a strict-mode collision. */}
          <HelpTip id="attach-existing" text={t('help.attach')} label={t('help.attach')} />
        </span>
        <SelectField
          testid={`code-group-set-${code.code}`}
          value={code.bundle}
          onChange={(e) => { void setBundle(code.id, e.target.value); }}
        >
          <option value="">{t('codeGroupNone')}</option>
          {bundles.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
        </SelectField>
      </label>
      {code.bundle !== '' && <BoundDetail code={code} />}
    </div>
  );
}

// BoundDetail — the expand-to-read-contents control, shown only once a group is bound.
function BoundDetail({ code }: { code: CodeView }) {
  const t = useTranslations('adminIntegrations.blocks');
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        data-testid="code-expand"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mono text-[10px] text-(--color-muted) hover:text-(--color-accent)"
      >
        {t('codeGroup', { name: code.bundle })}
      </button>
      {open && <CodeBlockList bundle={code.bundle} />}
    </div>
  );
}
