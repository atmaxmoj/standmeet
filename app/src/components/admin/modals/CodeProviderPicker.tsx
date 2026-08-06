// CodeProviderPicker —— code create modal 里的 provider 下拉。
//
// 空选项 = 不指定,这张码继承 role 的那条,role 也没有就走 owner 默认。选了就**压过 role**:
// 码是发出去的那张票,它说得更具体。条目来自 /admin/providers(那一面的 "provider book")。

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
