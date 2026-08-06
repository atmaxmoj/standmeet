// RoleProviderConfig —— role 卡上的 **provider 选择器 + 油表开关**。
//
// 两件事放一起是因为它们是同一件事的两半:走哪箱油,以及这箱油上要不要挂表。挂了表而那条
// provider 没加过油,仍然什么都不发生 —— 两个开关都得在。
//
// 建 role 时能选、建完改不了 = 那个字段实际上只能写一次(description 就吃过这个亏)。
// 跟卡上其他局部保存同一形态:改完立刻全量 PUT 回写(走 roleUpdatePayload,其余字段原样)。

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { ProviderSelect } from '@/components/admin/atoms/ProviderSelect';
import {
  roleUpdatePayload, useRoles, type RoleView, type WriteRoleInput,
} from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

export function RoleProviderConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const save = useCallback(
    (patch: Partial<WriteRoleInput>) => void run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, patch)),
      { success: `Provider updated for ${role.name}` },
    ),
    [role, roles, run],
  );
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1 items-start mt-0.5">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('common.provider')}
      </span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <ProviderSelect
          value={role.provider_id}
          onChange={(providerID) => save({ provider_id: providerID })}
          inheritLabel={t('roleCreate.providerDefault')}
          testid={`role-provider-${role.name}`}
        />
        <GaugeToggle role={role} save={save} />
      </div>
    </div>
  );
}

function GaugeToggle({
  role, save,
}: { role: RoleView; save: (patch: Partial<WriteRoleInput>) => void }) {
  const t = useTranslations('adminAccess');
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 shrink-0"
        checked={role.gas_metered}
        onChange={(e) => save({ gas_metered: e.target.checked })}
        data-testid={`role-gas-metered-${role.name}`}
      />
      <span className="reading-tight text-[11px] text-(--color-muted)">
        {t('roleGas.help')}
      </span>
    </label>
  );
}
