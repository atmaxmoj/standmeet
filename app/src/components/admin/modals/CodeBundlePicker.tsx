// CodeBundlePicker — which bundle of blocks this code carries.
//
// `docs/design/plugin/frontend.md` §3: "answering what can this code do means reading
// three screens" becomes "pick a bundle; read its list". This is the pick.
//
// A plain select over the bundles the owner already assembled, with an explicit "none"
// at the top. None is not a lesser choice — it means the code is judged by its role, the
// way every code issued before bundles existed still is — so it is spelled out rather
// than left as the empty first option a reader has to infer.

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { SelectField } from '@/components/atoms/SelectField';
import { useBundles } from '@/lib/admin/use-bundles';
import type { CodeFormHook } from '@/lib/admin/use-code-form';

export function CodeBundlePicker({ form }: { form: CodeFormHook }) {
  const t = useTranslations('adminIntegrations.blocks');
  const { bundles, ensureLoaded } = useBundles();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.08em] uppercase text-(--color-muted)">
        {t('codeBundleLabel')}
      </span>
      <SelectField
        testid="code-bundle-select"
        value={form.values.bundle}
        onChange={(e) => form.setBundle(e.target.value)}
      >
        <option value="">{t('codeBundleNone')}</option>
        {bundles.map((b) => (
          <option key={b.name} value={b.name}>{b.name}</option>
        ))}
      </SelectField>
    </label>
  );
}
