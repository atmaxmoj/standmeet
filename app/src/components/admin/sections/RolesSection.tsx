// RolesSection —— /admin/roles。design 源 docs/design/project/admin.js
// RolesSection (1124-1174)。两栏卡片：每卡 slug + [system] pill + description +
// prompt/corpus/skills/mcp/codes 五行 metadata + edit/delete actions（public
// 无 delete）。create modal 拆到 roles/RoleCreateModal.tsx 守 max-lines。

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { RoleCreateModal } from '@/components/admin/sections/roles/RoleCreateModal';
import { RoleCorpusConfig } from '@/components/admin/sections/roles/RoleCorpusConfig';
import { RoleToolsConfig } from '@/components/admin/sections/roles/RoleToolsConfig';
import { RoleDescriptionConfig } from '@/components/admin/sections/roles/RoleDescriptionConfig';
import { RoleDockConfig } from '@/components/admin/sections/roles/RoleDockConfig';
import { RoleProviderConfig } from '@/components/admin/sections/roles/RoleProviderConfig';
import { RoleGhostConfig } from '@/components/admin/sections/roles/RoleGhostConfig';
import { RoleWaypointsConfig } from '@/components/admin/sections/roles/RoleWaypointsConfig';
import { SelectField } from '@/components/atoms/SelectField';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import { usePrompts, type PromptView } from '@/lib/admin/use-prompts';
import {
  roleUpdatePayload, useRoles, type RolesHook, type RoleView, type WriteRoleInput,
} from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function RolesSection() {
  const hook = useRoles();
  const [creating, setCreating] = useState(false);
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="access · personas"
        slug="roles"
        count={titleCount(hook)}
        action={<NewRoleBtn onClick={() => setCreating(true)} />}
      />
      <Intro />
      <RolesBody hook={hook} />
      <RoleCreateModalSlot
        open={creating}
        onClose={() => setCreating(false)}
        createRole={hook.createRole}
      />
    </>
  );
}

function NewRoleBtn({ onClick }: { onClick: () => void }) {
  const t = useTranslations('adminAccess');
  return (
    <button
      type="button"
      data-testid="role-new"
      onClick={onClick}
      className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors"
    >
      {t('roles.new')}
    </button>
  );
}

function RoleCreateModalSlot({
  open, onClose, createRole,
}: {
  open: boolean;
  onClose: () => void;
  createRole: RolesHook['createRole'];
}) {
  const report = useReportError();
  // modal：成功 → 返回 RoleView（modal 内部 toast + close）；失败 → report 后返回 null，modal **保持开着**
  // 让 owner 看见错、改了重试。createRole 现在抛错，这里就地 try/catch 转成 modal 期望的 RoleView | null。
  const onCreate = useCallback(async (input: WriteRoleInput): Promise<RoleView | null> => {
    try {
      return await createRole(input);
    } catch (e) {
      report(e);
      return null;
    }
  }, [createRole, report]);
  return open ? <RoleCreateModal onClose={onClose} onCreate={onCreate} /> : null;
}

function titleCount(hook: RolesHook): string {
  return hook.status === 'ready' ? `${hook.roles.length}` : '';
}

function Intro() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t.rich('roles.intro', { em: (chunks) => <em>{chunks}</em> })}
    </p>
  );
}

function RolesBody({ hook }: { hook: RolesHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading ? <CardGridSkeleton /> : <RoleList hook={hook} />;
}

function RoleList({ hook }: { hook: RolesHook }) {
  return hook.roles.length === 0
    ? <EmptyRoles />
    : (
      <ul
        className="grid grid-cols-1 lg:grid-cols-2 gap-3.5"
        data-testid="role-list"
      >
        {hook.roles.map((r) => (
          <li key={r.id} data-testid={`role-row-${r.name}`}>
            <RoleCard role={r} onDelete={hook.deleteRole} />
          </li>
        ))}
      </ul>
    );
}

function EmptyRoles() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading italic text-(--color-muted)" data-testid="role-list">
      {t('roles.empty')}
    </p>
  );
}

function RoleCard({
  role, onDelete,
}: { role: RoleView; onDelete: (id: string) => Promise<void> }) {
  return (
    <article className="border border-(--color-rule) p-5 flex flex-col gap-2">
      <RoleCardHead role={role} onDelete={onDelete} />
      <RoleDescriptionConfig role={role} />
      <RoleMetaGrid role={role} />
      <RolePromptRow role={role} />
      <RoleProviderConfig role={role} />
      <RoleCorpusConfig role={role} />
      <RoleToolsConfig role={role} />
      <RoleDockConfig role={role} />
      <RoleWaypointsConfig role={role} />
      <RoleGhostConfig role={role} />
    </article>
  );
}

// RolePromptRow —— #103：显示并可编辑 role 挂的 prompt（引 prompts 库）。选另一份 / 清空 →
// updateRole 全量回写（PUT），useAction 成功/失败都 toast（改没生效 owner 要知道）。之前卡片只有
// delete，看不到也改不了挂的 prompt。
function RolePromptRow({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const hook = usePrompts();
  const roles = useRoles();
  const run = useAction();
  const onPick = useCallback(
    (promptID: string) => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, {
        prompt_id: promptID === '' ? null : promptID,
      })),
      { success: `Prompt updated for ${role.name}` },
    ),
    [role, roles, run],
  );
  return (
    <label className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 items-baseline mt-1.5">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
        {t('common.prompt')}
      </span>
      <RolePromptSelect role={role} prompts={hook.prompts} onPick={onPick} />
    </label>
  );
}

function RolePromptSelect({
  role, prompts, onPick,
}: {
  role: RoleView;
  prompts: readonly PromptView[];
  onPick: (promptID: string) => void;
}) {
  const t = useTranslations('adminAccess');
  return (
    <SelectField
      mono
      value={role.prompt_id ?? ''}
      onChange={(e) => onPick(e.target.value)}
      testid={`role-prompt-${role.name}`}
    >
      <option value="">{t('common.noneDash')}</option>
      {prompts.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </SelectField>
  );
}

function RoleCardHead({
  role, onDelete,
}: { role: RoleView; onDelete: (id: string) => Promise<void> }) {
  const t = useTranslations('adminAccess');
  return (
    <div className="flex justify-between items-baseline gap-2.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h4 className="font-serif text-[18px]">{role.name}</h4>
        {role.is_builtin && (
          <span
            className="mono text-[9px] tracking-[0.18em] uppercase text-(--color-violet)"
            data-testid="role-system-pill"
          >
            {t('common.systemPill')}
          </span>
        )}
      </div>
      {!role.is_builtin && <RoleDeleteBtn role={role} onDelete={onDelete} />}
    </div>
  );
}

function RoleDeleteBtn({
  role, onDelete,
}: { role: RoleView; onDelete: (id: string) => Promise<void> }) {
  const t = useTranslations('adminAccess');
  const run = useAction();
  // delete 是一键破坏性动作 → 成功/失败都用 toast 收尾（失败不再静默：删除没生效 owner 必须知道）。
  const handleDelete = useCallback(
    () => run(() => onDelete(role.id), { success: `Role ${role.name} deleted` }),
    [onDelete, role.id, role.name, run],
  );
  return (
    <button
      type="button"
      data-testid={`role-delete-${role.name}`}
      onClick={() => void handleDelete()}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('common.delete')}
    </button>
  );
}

// PUBLIC_ROLE_NAME —— builtin public 的 name（后端 access.PublicRoleName，不可改名）。
const PUBLIC_ROLE_NAME = 'public';

// corpusMetaOf —— 卡片上那行「corpus」。
//
// public 身份**没有正列表**：它读到的是 owner 发布过的那些，一条一条由笔记自己的开关定。
// 对它写 `0 URIs` 会是句谎话（"什么都读不到"），写 `3 URIs` 更糟（那是它以前那份被
// 悄悄种下的第二清单，F-D-7）。所以这里说它真正的范围在哪。
function corpusMetaOf(role: RoleView): string {
  return role.name === PUBLIC_ROLE_NAME
    ? 'what you published'
    : `${role.corpus_uris.length} URIs`;
}

function RoleMetaGrid({ role }: { role: RoleView }) {
  const cells: ReadonlyArray<readonly [string, string, boolean]> = [
    ['corpus', corpusMetaOf(role), false],
    ['skills', String(role.skill_ids.length), false],
    ['mcp', `${role.mcp_server_ids.length} servers`, false],
    ['codes', `${role.active_codes} active`, role.active_codes > 0],
  ];
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1.5 mt-3 pt-2.5 border-t border-(--color-rule)/60 items-baseline">
      {cells.map(([label, value, highlight]) => (
        <RoleMetaCell key={label} label={label} value={value} highlight={highlight} />
      ))}
    </div>
  );
}

function RoleMetaCell({
  label, value, highlight,
}: { label: string; value: string; highlight: boolean }) {
  return (
    <>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
        {label}
      </span>
      <span
        className={`mono text-[11px] ${highlight ? 'text-(--color-accent)' : 'text-(--color-ink)'}`}
        data-testid={`role-meta-${label}`}
      >
        {value}
      </span>
    </>
  );
}
