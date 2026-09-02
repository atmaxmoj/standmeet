// RoleProviderConfig —— the **provider selector + gas-metering toggle** on the role card.
//
// The two live together because they're two halves of one thing: which tank of gas to draw
// from, and whether to meter that tank. Metering a provider that was never fueled still does
// nothing — both switches have to be set.
//
// Selectable at role creation but not after = that field was effectively write-once
// (description suffered the same bug). Same shape as the card's other local saves: edit →
// immediate full PUT write-back (via roleUpdatePayload, other fields untouched).

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
