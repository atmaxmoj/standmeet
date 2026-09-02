// RoleDockConfig —— #109/#110 chat dock button config on the role card. Two fixed button
// slots (= two chat positions); each slot = capability dropdown (label passes through the
// MCP title) + trigger-phrase input. Save → updateRole writes dock_buttons back in full,
// frozen into subsequent sessions. An empty slot (no capability chosen) is dropped on save.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { SelectField } from '@/components/atoms/SelectField';
import { useCapabilities, type CapabilityRow } from '@/lib/admin/use-capabilities';
import {
  roleUpdatePayload, useRoles, type DockButtonConfig, type RoleView,
} from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

type Slot = { capability_id: string; trigger: string };

// DOCK_INELIGIBLE —— a dock button is a **visitor action** (clicking it sends the trigger
// as a visitor message); grounding / agent-internal capabilities are not actions a visitor
// can "do", so they must never show up in the dock dropdown (F-A-8). `corpus.retrieval` is
// the agent's own retrieval tool — turning it into a button would rebuild the CorpusSearchBox
// that F-A-2 removed (violates the "a chat, not a page, never quote corpus verbatim" thesis).
// Filtering at the **dropdown source** makes this violation structurally unclickable, not
// merely unclicked. New grounding capabilities should be added here.
const DOCK_INELIGIBLE = new Set(['corpus.retrieval']);

export function RoleDockConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const caps = useCapabilities();
  const roles = useRoles();
  const run = useAction();
  // No other component on /admin/roles loads the capability list; the dropdown depends on this.
  const ensureCaps = caps.ensureLoaded;
  useEffect(() => { void ensureCaps(); }, [ensureCaps]);
  const [slots, setSlots] = useState<Slot[]>(() => seedSlots(role.dock_buttons));
  const setSlot = useCallback((i: number, patch: Partial<Slot>) => {
    setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }, []);
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, {
        dock_buttons: slotsToButtons(slots),
      })),
      { success: `Dock buttons updated for ${role.name}` },
    ),
    [role, roles, run, slots],
  );
  const options = caps.rows.filter((r) => r.title && !DOCK_INELIGIBLE.has(r.id));
  return (
    <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('roleDock.label')}
      </span>
      <div className="flex flex-col gap-2 min-w-0">
        <p className="reading-tight text-[11px] text-(--color-muted)" data-testid="role-dock-help">
          {t('roleDock.help')}
        </p>
        {slots.map((slot, i) => (
          <DockSlotRow key={i} idx={i} slot={slot} options={options} onSlot={setSlot} />
        ))}
        <DockSaveBtn role={role} onSave={onSave} />
      </div>
    </div>
  );
}

function DockSlotRow({
  idx, slot, options, onSlot,
}: {
  idx: number;
  slot: Slot;
  options: readonly CapabilityRow[];
  onSlot: (i: number, patch: Partial<Slot>) => void;
}) {
  const t = useTranslations('adminAccess');
  return (
    // Stacked, not side-by-side (UX-49): side-by-side left the input too narrow, so the
    // card's right edge clipped the placeholder to `trigger phrase (e.g. s` — **the clipped
    // part is the only concrete example of what to write**. The help text above explains
    // the concept of a trigger phrase, but only that example shows the actual shape.
    // The copy isn't too long; the layout just didn't give it enough room — stacking the
    // input gives it the whole card width.
    <div className="flex flex-col gap-1.5">
      <SelectField
        className="w-full"
        mono
        value={slot.capability_id}
        onChange={(e) => onSlot(idx, { capability_id: e.target.value })}
        testid={`role-dock-cap-${idx}`}
      >
        <option value="">{t('common.noneDash')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.title}</option>
        ))}
      </SelectField>
      <input
        type="text"
        className="sm-field-input min-w-0"
        value={slot.trigger}
        onChange={(e) => onSlot(idx, { trigger: e.target.value })}
        placeholder={t('roleDock.triggerPlaceholder')}
        data-testid={`role-dock-trigger-${idx}`}
      />
    </div>
  );
}

function DockSaveBtn({ role, onSave }: { role: RoleView; onSave: () => Promise<void> }) {
  const t = useTranslations('adminAccess');
  return (
    <button
      type="button"
      onClick={() => void onSave()}
      data-testid="role-dock-save"
      className="self-start mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('roleDock.save', { name: role.name })}
    </button>
  );
}

// seedSlots —— lay the role's existing dock_buttons into the two fixed slots (pad with
// empty slots if fewer).
function seedSlots(buttons: readonly DockButtonConfig[] | undefined): Slot[] {
  const got = buttons ?? [];
  return [0, 1].map((i) => slotFrom(got[i]));
}

function slotFrom(b: DockButtonConfig | undefined): Slot {
  return b
    ? { capability_id: b.capability_id, trigger: b.trigger }
    : { capability_id: '', trigger: '' };
}

// slotsToButtons —— keep only slots with a capability chosen (empty slots dropped).
// Non-empty trigger validation is the backend's job.
function slotsToButtons(slots: readonly Slot[]): DockButtonConfig[] {
  return slots
    .filter((s) => s.capability_id !== '')
    .map((s) => ({ capability_id: s.capability_id, trigger: s.trigger }));
}

