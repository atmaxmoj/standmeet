// RoleWaypointsConfig —— F-A-7 **ghost-steering waypoints editor** on the role card. The
// whole waypoint mechanism (domain / role_waypoints table / ghost policy / freeze /
// visited-ledger) has long existed on the backend, and the admin API already round-trips
// `waypoints` — the owner just had nowhere to write it in the GUI, so every role on a real
// instance sat at `waypoints: []` and the ghost had nowhere to steer to. This adds the
// editor: add/edit/delete a waypoint (id + description + weight + terminal flag + evidence
// URIs), save → full write-back via roleUpdatePayload (other fields untouched), frozen into
// subsequent sessions. Pairs with the F-A-10 "require evidence" toggle.

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { roleUpdatePayload, useRoles, type RoleView, type WaypointConfig } from '@/lib/admin/use-roles';
import { blankWaypoint, cleanWaypoints, parseEvidence } from '@/lib/admin/waypoints';
import { useAction } from '@/lib/ui/use-action';

export function RoleWaypointsConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const [wps, setWps] = useState<WaypointConfig[]>(() => [...(role.waypoints ?? [])]);
  const setField = useCallback((i: number, patch: Partial<WaypointConfig>) => {
    setWps((s) => s.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  }, []);
  const remove = useCallback((i: number) => setWps((s) => s.filter((_, j) => j !== i)), []);
  const add = useCallback(() => setWps((s) => [...s, blankWaypoint()]), []);
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, { waypoints: cleanWaypoints(wps) })),
      { success: `Waypoints updated for ${role.name}` },
    ),
    [role, roles, run, wps],
  );
  return (
    <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('roleWaypoints.label')}
      </span>
      <div className="flex flex-col gap-2 min-w-0">
        <p className="reading-tight text-[11px] text-(--color-muted)" data-testid="role-wp-help">
          {t('roleWaypoints.help')}
        </p>
        {wps.map((wp, i) => (
          <WaypointRow key={i} idx={i} wp={wp} onField={setField} onRemove={remove} />
        ))}
        <div className="flex items-center gap-4">
          <AddBtn onAdd={add} />
          <SaveBtn role={role} onSave={onSave} />
        </div>
      </div>
    </div>
  );
}

function WaypointRow({
  idx, wp, onField, onRemove,
}: {
  idx: number;
  wp: WaypointConfig;
  onField: (i: number, patch: Partial<WaypointConfig>) => void;
  onRemove: (i: number) => void;
}) {
  const t = useTranslations('adminAccess');
  return (
    <div
      className="flex flex-col gap-1 border-l-2 border-(--color-rule) pl-2.5"
      data-testid={`role-wp-row-${idx}`}
    >
      <div className="flex gap-2 min-w-0">
        <input
          type="text"
          className="sm-field-input sm-mono basis-[38%] shrink-0 min-w-0"
          value={wp.waypoint_id}
          onChange={(e) => onField(idx, { waypoint_id: e.target.value })}
          placeholder={t('roleWaypoints.idPlaceholder')}
          data-testid={`role-wp-id-${idx}`}
        />
        <input
          type="text"
          className="sm-field-input grow basis-0 min-w-0"
          value={wp.description}
          onChange={(e) => onField(idx, { description: e.target.value })}
          placeholder={t('roleWaypoints.descPlaceholder')}
          data-testid={`role-wp-desc-${idx}`}
        />
      </div>
      <input
        type="text"
        className="sm-field-input sm-mono sm-field-xs min-w-0"
        value={wp.evidence_refs.join(', ')}
        onChange={(e) => onField(idx, { evidence_refs: parseEvidence(e.target.value) })}
        placeholder={t('roleWaypoints.evidencePlaceholder')}
        data-testid={`role-wp-evidence-${idx}`}
      />
      <WaypointMeta idx={idx} wp={wp} onField={onField} onRemove={onRemove} />
    </div>
  );
}

function WaypointMeta({
  idx, wp, onField, onRemove,
}: {
  idx: number;
  wp: WaypointConfig;
  onField: (i: number, patch: Partial<WaypointConfig>) => void;
  onRemove: (i: number) => void;
}) {
  const t = useTranslations('adminAccess');
  return (
    <div className="flex items-center gap-4 mono text-[10.5px] text-(--color-muted)">
      <label className="flex items-center gap-1.5">
        <span className="tracking-[0.12em] uppercase text-(--color-faint)">
          {t('roleWaypoints.weightLabel')}
        </span>
        <input
          type="number"
          className="sm-field-input sm-mono sm-field-xs w-14 text-center"
          value={wp.weight}
          onChange={(e) => onField(idx, { weight: Number(e.target.value) || 0 })}
          data-testid={`role-wp-weight-${idx}`}
        />
      </label>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={wp.is_terminal}
          onChange={(e) => onField(idx, { is_terminal: e.target.checked })}
          data-testid={`role-wp-terminal-${idx}`}
        />
        <span className="tracking-[0.12em] uppercase text-(--color-faint)">
          {t('roleWaypoints.terminalLabel')}
        </span>
      </label>
      <button
        type="button"
        onClick={() => onRemove(idx)}
        data-testid={`role-wp-remove-${idx}`}
        className="ml-auto tracking-[0.12em] uppercase hover:text-(--color-accent)"
      >
        {t('roleWaypoints.remove')}
      </button>
    </div>
  );
}

function AddBtn({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations('adminAccess');
  return (
    <button
      type="button"
      onClick={onAdd}
      data-testid="role-wp-add"
      className="self-start mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('roleWaypoints.add')}
    </button>
  );
}

function SaveBtn({ role, onSave }: { role: RoleView; onSave: () => Promise<void> }) {
  const t = useTranslations('adminAccess');
  return (
    <button
      type="button"
      onClick={() => void onSave()}
      data-testid="role-wp-save"
      className="self-start mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('roleWaypoints.save', { name: role.name })}
    </button>
  );
}
