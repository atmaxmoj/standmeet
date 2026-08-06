// RoleProviderConfig —— role 卡上的 **provider 选择器**。
//
// 建 role 时能选,建完改不了 = 那个字段实际上只能写一次(description 就吃过这个亏)。
// 跟卡上其他局部保存同一形态:选完立刻全量 PUT 回写(走 roleUpdatePayload,只表达
// provider_id 变,其余字段原样保留)。

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { ProviderSelect } from '@/components/admin/atoms/ProviderSelect';
import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

export function RoleProviderConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const onPick = useCallback(
    (providerID: string) => void run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, { provider_id: providerID })),
      { success: `Provider updated for ${role.name}` },
    ),
    [role, roles, run],
  );
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1 items-start mt-0.5">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('common.provider')}
      </span>
      <ProviderSelect
        value={role.provider_id}
        onChange={onPick}
        inheritLabel={t('roleCreate.providerDefault')}
        testid={`role-provider-${role.name}`}
      />
    </div>
  );
}
