// RoleDockConfig —— #109/#110 role 卡上的 chat dock 按钮配置。两个固定按钮位（= 聊天两个位置）；
// 每位 = 能力下拉（label 透传 MCP title）+ 触发词输入。存 → updateRole 全量回写 dock_buttons，
// 冻进后续 session。空 slot（没选能力）存时丢掉。

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { useCapabilities, type CapabilityRow } from '@/lib/admin/use-capabilities';
import {
  useRoles, type DockButtonConfig, type RoleView, type WriteRoleInput,
} from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

type Slot = { capability_id: string; trigger: string };

export function RoleDockConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const caps = useCapabilities();
  const roles = useRoles();
  const run = useAction();
  // /admin/roles 页没有别的组件加载能力列表；下拉选项靠它。
  const ensureCaps = caps.ensureLoaded;
  useEffect(() => { void ensureCaps(); }, [ensureCaps]);
  const [slots, setSlots] = useState<Slot[]>(() => seedSlots(role.dock_buttons));
  const setSlot = useCallback((i: number, patch: Partial<Slot>) => {
    setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }, []);
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, dockPayload(role, slotsToButtons(slots))),
      { success: `Dock buttons updated for ${role.name}` },
    ),
    [role, roles, run, slots],
  );
  const options = caps.rows.filter((r) => r.title);
  return (
    <div className="mt-2 grid grid-cols-[90px_1fr] gap-x-3 gap-y-2 items-start">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('roleDock.label')}
      </span>
      <div className="flex flex-col gap-2">
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
    <div className="flex gap-2">
      <select
        className="mono text-[11px] bg-(--color-paper) border border-(--color-rule) px-2 py-1 shrink-0"
        value={slot.capability_id}
        onChange={(e) => onSlot(idx, { capability_id: e.target.value })}
        data-testid={`role-dock-cap-${idx}`}
      >
        <option value="">{t('common.noneDash')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.title}</option>
        ))}
      </select>
      <input
        type="text"
        className="flex-1 bg-transparent border-b border-(--color-rule) py-1 reading-tight text-[13px]"
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

// seedSlots —— role 现有 dock_buttons 铺到两个固定位（不足补空 slot）。
function seedSlots(buttons: readonly DockButtonConfig[] | undefined): Slot[] {
  const got = buttons ?? [];
  return [0, 1].map((i) => slotFrom(got[i]));
}

function slotFrom(b: DockButtonConfig | undefined): Slot {
  return b
    ? { capability_id: b.capability_id, trigger: b.trigger }
    : { capability_id: '', trigger: '' };
}

// slotsToButtons —— 只保留选了能力的 slot（空位丢掉）。触发词非空校验交后端。
function slotsToButtons(slots: readonly Slot[]): DockButtonConfig[] {
  return slots
    .filter((s) => s.capability_id !== '')
    .map((s) => ({ capability_id: s.capability_id, trigger: s.trigger }));
}

// dockPayload —— 从 RoleView + 新 dock_buttons 组全量 PUT 载荷（只有 dock 变，其余原样回写）。
function dockPayload(role: RoleView, buttons: DockButtonConfig[]): WriteRoleInput {
  return {
    name: role.name,
    description: role.description,
    greeting: role.greeting,
    prompt_id: role.prompt_id ?? null,
    corpus_uris: role.corpus_uris,
    skill_ids: role.skill_ids,
    mcp_server_ids: role.mcp_server_ids,
    dock_buttons: buttons,
  };
}
