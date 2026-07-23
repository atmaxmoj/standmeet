// RoleGhostConfig —— F-A-10 role 卡上的 ghost-evidence 规则开关。开 → 内容型 steering ghost
// 必须带语料证据(空证据的非终点 waypoint 不当引导提出;booking 等终点 waypoint 不受影响)。
// 存 → updateRole 全量回写 require_ghost_evidence(其余字段原样),冻进后续 session;code 可覆盖。

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

export function RoleGhostConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const [requireEvidence, setRequire] = useState<boolean>(role.require_ghost_evidence ?? false);
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, {
        require_ghost_evidence: requireEvidence,
      })),
      { success: `Ghost rule updated for ${role.name}` },
    ),
    [role, roles, run, requireEvidence],
  );
  return (
    <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('roleGhost.label')}
      </span>
      <div className="flex flex-col gap-2 min-w-0">
        <label className="flex items-start gap-2 cursor-pointer" data-testid="role-ghost-evidence">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={requireEvidence}
            onChange={(e) => setRequire(e.target.checked)}
            data-testid="role-ghost-evidence-toggle"
          />
          <span className="reading-tight text-[11px] text-(--color-muted)">
            {t('roleGhost.help')}
          </span>
        </label>
        <button
          type="button"
          onClick={() => void onSave()}
          data-testid="role-ghost-save"
          className="self-start mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
        >
          {t('roleGhost.save', { name: role.name })}
        </button>
      </div>
    </div>
  );
}

