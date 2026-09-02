// RoleToolsConfig —— the **tool-grant editor** on the role card: which skills this role can
// use, which external MCP servers it may call.
//
// The top of /admin/roles says a role bundles "a set of skills, and which MCP servers it
// may call", and the api·mcp panel says, right after registering a server, "then attach it
// to a role under codes". But these two lists **used to be settable only once, in the
// "+ NEW ROLE" modal** — the card kept only the two read-only lines `SKILLS 0` /
// `MCP 0 servers` (F-D-9).
//
// The consequence isn't "inconvenient": `invited` and `public` are seeder-created and never
// went through that modal. So the default role every blank code falls back to **could never
// get any external MCP server**, and the owner's only way out was to create a new role and
// resend every code. The backend was never missing this capability: Update in
// usecase/roles.go always accepted corpus_uris + skill_ids + mcp_server_ids, and
// syncRoleJoins synced all three joins together — only the UI was missing.
//
// This is the same class of bug as F-A-11: there it was the corpus positive list locking
// once the role was created, fixed by RoleCorpusConfig. Shape copied from it: inline edit
// on the card → full PUT write-back (only these two lists change), frozen into subsequent
// sessions.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { RoleMultiSelect } from '@/components/admin/sections/roles/RoleMultiSelect';
import { useMCPServers } from '@/lib/admin/use-mcp-servers';
import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useSkills } from '@/lib/admin/use-skills';
import { useAction } from '@/lib/ui/use-action';

// PUBLIC_ROLE_NAME —— the builtin public role's name. It **has no tools by definition**
// (the card's own words: "No skills, no MCP"), so this slot isn't an editor for it — the
// same branch as RoleCorpusConfig.
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
