import { listContent, readContent } from "./content-api.js";
import { listSkills, getSkill } from "./skill-api.js";
import { listMcpServers } from "./mcp-server-api.js";
import { listRoles } from "./role-api.js";
import { listInvites } from "./invite-api.js";
import { getSettings } from "./settings-api.js";
import { listAssets, getAsset } from "./asset-api.js";
import { loadConfig } from "../config/manager.js";
import type {
  ExportManifest,
  ExportContentEntry,
  ExportSkill,
  ExportMcpServer,
  ExportRole,
  ExportInvite,
  ExportSettings,
  ExportAsset,
} from "../types.js";

export type ExportCategory = "content" | "skills" | "mcp_servers" | "roles" | "invites" | "settings" | "assets";

export async function buildExportData(): Promise<ExportManifest> {
  const [contentList, skillsList, mcpServersList, rolesList, invitesList, settings, assetsList] =
    await Promise.all([
      listContent(), listSkills(), listMcpServers(), listRoles(), listInvites(), getSettings(), listAssets(),
    ]);

  const content: ExportContentEntry[] = await Promise.all(
    contentList.map(async (item) => {
      const full = await readContent(item.path);
      return { path: full.path, content: full.content, summary: full.summary, visibility: full.visibility, show_as_source: full.show_as_source };
    }),
  );

  const skills: ExportSkill[] = [];
  for (const item of skillsList) {
    if (item.is_builtin) continue;
    const full = await getSkill(item.id);
    skills.push({ name: full.name, description: full.description, prompt: full.prompt, skill_md_raw: full.skill_md_raw, scripts: full.scripts });
  }

  const mcp_servers: ExportMcpServer[] = mcpServersList.map((s) => ({ name: s.name, config: s.config }));
  const roles: ExportRole[] = rolesList.map((r) => ({ name: r.name, permissions: r.permissions, prompt: r.prompt }));

  const roleMap = new Map(rolesList.map((r) => [r.id, r.name]));
  const skillMap = new Map(skillsList.map((s) => [s.id, s.name]));
  const mcpMap = new Map(mcpServersList.map((m) => [m.id, m.name]));

  const invites: ExportInvite[] = invitesList
    .filter((inv) => inv.is_active)
    .map((inv) => ({
      label: inv.label,
      role_name: inv.role_id ? (roleMap.get(inv.role_id) ?? null) : null,
      prompt: inv.prompt,
      greeting: inv.greeting,
      max_uses: inv.max_uses,
      max_messages_per_session: inv.max_messages_per_session,
      mcp_server_names: inv.mcp_server_ids.map((id) => mcpMap.get(id)).filter(Boolean) as string[],
      skill_names: inv.skill_ids.map((id) => skillMap.get(id)).filter(Boolean) as string[],
    }));

  const exportSettings: ExportSettings = {
    public_access: settings.public_access,
    ai_system_prompt: settings.ai_system_prompt,
  };

  const assets: ExportAsset[] = assetsList.map((a) => ({ path: a.path, visibility: a.visibility }));

  return {
    version: 1, exported_at: new Date().toISOString(),
    content, skills, mcp_servers, roles, invites, settings: exportSettings, assets,
  };
}

export async function buildCategoryExportData(category: ExportCategory): Promise<unknown> {
  switch (category) {
    case "content": {
      const contentList = await listContent();
      return Promise.all(contentList.map(async (item) => {
        const full = await readContent(item.path);
        return { path: full.path, content: full.content, summary: full.summary, visibility: full.visibility, show_as_source: full.show_as_source };
      }));
    }
    case "skills": {
      const skillsList = await listSkills();
      const results: ExportSkill[] = [];
      for (const item of skillsList) {
        if (item.is_builtin) continue;
        const full = await getSkill(item.id);
        results.push({ name: full.name, description: full.description, prompt: full.prompt, skill_md_raw: full.skill_md_raw, scripts: full.scripts });
      }
      return results;
    }
    case "mcp_servers": {
      const servers = await listMcpServers();
      return servers.map((s) => ({ name: s.name, config: s.config }));
    }
    case "roles": {
      const r = await listRoles();
      return r.map((role) => ({ name: role.name, permissions: role.permissions, prompt: role.prompt }));
    }
    case "invites":
      return buildInvitesExport();
    case "settings": {
      const s = await getSettings();
      return { public_access: s.public_access, ai_system_prompt: s.ai_system_prompt };
    }
    case "assets": {
      const a = await listAssets();
      return a.map((asset) => ({ path: asset.path, visibility: asset.visibility }));
    }
  }
}

async function buildInvitesExport() {
  const [invitesList, rolesList, skillsList, mcpServersList] = await Promise.all([
    listInvites(), listRoles(), listSkills(), listMcpServers(),
  ]);
  const roleMap = new Map(rolesList.map((r) => [r.id, r.name]));
  const skillMap = new Map(skillsList.map((s) => [s.id, s.name]));
  const mcpMap = new Map(mcpServersList.map((m) => [m.id, m.name]));
  return invitesList
    .filter((inv) => inv.is_active)
    .map((inv) => ({
      label: inv.label,
      role_name: inv.role_id ? (roleMap.get(inv.role_id) ?? null) : null,
      prompt: inv.prompt, greeting: inv.greeting,
      max_uses: inv.max_uses, max_messages_per_session: inv.max_messages_per_session,
      mcp_server_names: inv.mcp_server_ids.map((id) => mcpMap.get(id)).filter(Boolean),
      skill_names: inv.skill_ids.map((id) => skillMap.get(id)).filter(Boolean),
    }));
}

async function downloadAssetFiles(assetPaths: string[]): Promise<Map<string, Buffer>> {
  const config = loadConfig();
  if (!config) throw new Error("Not configured.");
  const result = new Map<string, Buffer>();
  for (const assetPath of assetPaths) {
    try {
      const asset = await getAsset(assetPath);
      if (!asset.download_url) continue;
      const response = await fetch(asset.download_url);
      if (!response.ok) continue;
      const arrayBuffer = await response.arrayBuffer();
      result.set(assetPath, Buffer.from(arrayBuffer));
    } catch {
      // Skip assets that fail to download
    }
  }
  return result;
}
