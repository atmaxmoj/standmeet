// RoleGhostConfig —— F-A-10 ghost-evidence rule toggle on the role card. On → a content-type
// steering ghost must carry corpus evidence (a non-terminal waypoint with no evidence is not
// offered as a lead; terminal waypoints like booking are unaffected). Save → updateRole
// writes require_ghost_evidence back in full (other fields untouched), frozen into
// subsequent sessions; a code can override it.

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

