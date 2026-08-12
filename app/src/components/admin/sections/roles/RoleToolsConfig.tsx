// RoleToolsConfig —— role 卡上的**工具授权编辑器**：这个角色可以用哪些 skill、可以调用
// 哪些外部 MCP server。
//
// /admin/roles 顶上写着 role 捆绑「a set of skills, and which MCP servers it may call」，
// api·mcp 面板注册完一台 server 也写着 "then attach it to a role under codes"。可这两份
// 清单过去**只有「+ NEW ROLE」弹窗里能设一次** —— 卡片上只剩 `SKILLS 0` / `MCP 0 servers`
// 两行只读文字（F-D-9）。
//
// 后果不是"不方便"：`invited` 和 `public` 是 seeder 建的，从来没经过那个弹窗。于是每一张
// 留空的码走的那个默认角色**永远拿不到任何一台外部 MCP server**，owner 唯一的出路是新建
// 一个角色再把码重发一遍。而后端从不缺这个能力：usecase/roles.go 的 Update 一直收
// corpus_uris + skill_ids + mcp_server_ids，syncRoleJoins 三组 join 一起同步 —— 缺的只是这张脸。
//
// 这是 F-A-11 的同款：那次是 corpus 正列表建完就锁死，修法是 RoleCorpusConfig。形态照抄它：
// 卡上 inline 编辑 → 全量 PUT 回写（只有这两份清单变），冻进后续 session。

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { RoleMultiSelect } from '@/components/admin/sections/roles/RoleMultiSelect';
import { useMCPServers } from '@/lib/admin/use-mcp-servers';
import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useSkills } from '@/lib/admin/use-skills';
import { useAction } from '@/lib/ui/use-action';

// PUBLIC_ROLE_NAME —— builtin public 的 name。它**按定义没有工具**（卡上的原话：
// "No skills, no MCP"），所以这一格对它不是编辑器，跟 RoleCorpusConfig 同样的分叉。
const PUBLIC_ROLE_NAME = 'public';

export function RoleToolsConfig({ role }: { role: RoleView }) {
  return role.name === PUBLIC_ROLE_NAME ? null : <EditableToolsConfig role={role} />;
}

function EditableToolsConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const skills = useSkills();
  const mcp = useMCPServers();
  const [skillIDs, setSkillIDs] = useState<string[]>(() => [...role.skill_ids]);
  const [serverIDs, setServerIDs] = useState<string[]>(() => [...role.mcp_server_ids]);
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, {
        skill_ids: skillIDs, mcp_server_ids: serverIDs,
      })),
      { success: `Tool grants updated for ${role.name}` },
    ),
    [role, roles, run, skillIDs, serverIDs],
  );
  return (
    <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('common.tools')}
      </span>
      <div className="flex flex-col gap-3">
        <p className="reading-tight text-[11px] text-(--color-muted)" data-testid="role-tools-help">
          {t('roleTools.help')}
        </p>
        <RoleMultiSelect
          label="skills"
          options={skills.skills.map((s) => ({ id: s.id, label: s.name }))}
          value={skillIDs}
          onChange={setSkillIDs}
          testid={`role-tools-skills-${role.name}`}
        />
        <RoleMultiSelect
          label="mcp servers"
          options={mcp.servers.map((m) => ({ id: m.id, label: m.name }))}
          value={serverIDs}
          onChange={setServerIDs}
          testid={`role-tools-mcp-${role.name}`}
        />
        <ToolsSaveBtn role={role} onSave={onSave} />
      </div>
    </div>
  );
}

function ToolsSaveBtn({ role, onSave }: { role: RoleView; onSave: () => void }) {
  const t = useTranslations('adminAccess');
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onSave}
        data-testid="role-tools-save"
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) hover:underline"
      >
        {t('roleTools.save', { name: role.name })}
      </button>
    </div>
  );
}
