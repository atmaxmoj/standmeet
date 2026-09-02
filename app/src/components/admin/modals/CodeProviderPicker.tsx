// CodeProviderPicker — the provider dropdown inside the code create modal.
//
// Empty option = unspecified: this code inherits the role's provider, or the owner
// default if the role has none either. Picking one **overrides the role** — the code
// is the ticket that's actually handed out, so it's more specific. Options come from
// /admin/providers (that page's "provider book").

import { useTranslations } from 'next-intl';

import { ProviderSelect } from '@/components/admin/atoms/ProviderSelect';
import type { CodeFormHook } from '@/lib/admin/use-code-form';

export function CodeProviderPicker({ form }: { form: CodeFormHook }) {
  const t = useTranslations('adminShell.codeModal');
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h3 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-ink)">
          {t('providerTitle')}
        </h3>
        <span className="mono text-[9.5px] text-(--color-faint)">{t('providerSubtitle')}</span>
      </div>
      <ProviderSelect
        value={form.values.providerID}
        onChange={form.setProviderID}
        inheritLabel={t('providerInherit')}
        testid="code-field-provider"
      />
    </div>
  );
}
