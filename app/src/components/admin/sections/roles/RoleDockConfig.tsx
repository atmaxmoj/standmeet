// RoleDockConfig —— #109/#110 role 卡上的 chat dock 按钮配置。两个固定按钮位（= 聊天两个位置）；
// 每位 = 能力下拉（label 透传 MCP title）+ 触发词输入。存 → updateRole 全量回写 dock_buttons，
// 冻进后续 session。空 slot（没选能力）存时丢掉。

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { SelectField } from '@/components/atoms/SelectField';
import { useCapabilities, type CapabilityRow } from '@/lib/admin/use-capabilities';
import {
  roleUpdatePayload, useRoles, type DockButtonConfig, type RoleView,
} from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

type Slot = { capability_id: string; trigger: string };

// DOCK_INELIGIBLE —— dock 按钮是**访客动作**(点了把 trigger 当访客消息发出去);grounding /
// agent-internal 能力不是访客能"做"的动作,绝不能出现在 dock 下拉里(F-A-8)。`corpus.retrieval`
// 是 agent 的检索工具 —— 把它当按钮 = 重建 F-A-2 删掉的 CorpusSearchBox(违反"a chat, not a page,
// 永不逐字复述语料"的 thesis)。在**下拉源头**过滤,让这个违规结构上无法被点出来(而非只是没点)。
// 新增的 grounding 能力应加进这里。
const DOCK_INELIGIBLE = new Set(['corpus.retrieval']);

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
    // 上下两行,不是并排(UX-49):并排时输入分到的宽度不够,占位符被卡片右缘切成
    // `trigger phrase (e.g. s` —— **被切掉的恰恰是唯一给出具体写法的例子**。
    // 上面那段说明讲清了"触发语是什么概念",但"该写成什么样子"只有那个例子在说。
    // 不是文案太长,是布局没给够;竖过来输入就拿到整张卡片的宽度。
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
        className="w-full min-w-0 bg-transparent border-b border-(--color-rule) py-1 reading-tight text-[13px]"
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

