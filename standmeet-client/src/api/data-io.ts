import { readContent, createContent, updateContent } from "./content-api.js";
import { listSkills, createSkill, importSkillMd } from "./skill-api.js";
import { listMcpServers, createMcpServer } from "./mcp-server-api.js";
import { listRoles, createRole, updateRole } from "./role-api.js";
import { listInvites, createInvite } from "./invite-api.js";
import { updateSettings } from "./settings-api.js";
import { listAssets, uploadAsset } from "./asset-api.js";
import type {
  ExportManifest,
  ImportSelection,
  ImportResult,
  CategoryResult,
} from "../types.js";

// Re-export from data-export for backward compatibility
export { buildExportData, buildCategoryExportData } from "./data-export.js";
export type { ExportCategory } from "./data-export.js";

function emptyResult(): CategoryResult {
  return { created: 0, updated: 0, skipped: 0, failed: 0 };
}

function emptyManifest(): ExportManifest {
  return {
    version: 1, exported_at: "",
    content: [], skills: [], mcp_servers: [], roles: [], invites: [],
    settings: { public_access: false, ai_system_prompt: "" }, assets: [],
  };
}

export async function importCategoryData(
  category: string,
  data: unknown,
): Promise<CategoryResult> {
  const manifest = emptyManifest();
  const selection: ImportSelection = {
    content: false, skills: false, mcp_servers: false,
    roles: false, invites: false, settings: false, assets: false,
  };
  if (category === "settings") {
    manifest.settings = data as ExportManifest["settings"];
  } else {
    (manifest as unknown as Record<string, unknown>)[category] = data;
  }
  selection[category as keyof ImportSelection] = true;
  const result = await importData(manifest, selection);
  return result[category as keyof ImportResult];
}

export async function importData(
  manifest: ExportManifest,
  selected: ImportSelection,
  assetBuffers?: Map<string, Buffer>,
): Promise<ImportResult> {
  const result: ImportResult = {
    content: emptyResult(), skills: emptyResult(), mcp_servers: emptyResult(),
    roles: emptyResult(), invites: emptyResult(), settings: emptyResult(), assets: emptyResult(),
  };

  if (selected.content) await importContent(manifest, result);
  if (selected.skills) await importSkills(manifest, result);
  if (selected.mcp_servers) await importMcpServers(manifest, result);
  if (selected.roles) await importRoles(manifest, result);
  if (selected.invites) await importInvites(manifest, result);
  if (selected.settings) await importSettings(manifest, result);
  if (selected.assets && assetBuffers) await importAssets(manifest, result, assetBuffers);

  return result;
}

async function importContent(manifest: ExportManifest, result: ImportResult) {
  for (const entry of manifest.content) {
    try {
      try {
        await readContent(entry.path);
        await updateContent(entry.path, entry.content, entry.summary, entry.visibility, entry.show_as_source);
        result.content.updated++;
      } catch {
        await createContent(entry.path, entry.content, entry.summary, entry.visibility, entry.show_as_source);
        result.content.created++;
      }
    } catch {
      result.content.failed++;
    }
  }
}

async function importSkills(manifest: ExportManifest, result: ImportResult) {
  const existingNames = new Set((await listSkills()).map((s) => s.name));
  for (const skill of manifest.skills) {
    if (existingNames.has(skill.name)) { result.skills.skipped++; continue; }
    try {
      if (skill.skill_md_raw) { await importSkillMd(skill.skill_md_raw); }
      else { await createSkill(skill.name, skill.description, skill.prompt); }
      result.skills.created++;
    } catch { result.skills.failed++; }
  }
}

async function importMcpServers(manifest: ExportManifest, result: ImportResult) {
  const existingNames = new Set((await listMcpServers()).map((s) => s.name));
  for (const server of manifest.mcp_servers) {
    if (existingNames.has(server.name)) { result.mcp_servers.skipped++; continue; }
    try { await createMcpServer(server.name, server.config); result.mcp_servers.created++; }
    catch { result.mcp_servers.failed++; }
  }
}

async function importRoles(manifest: ExportManifest, result: ImportResult) {
  const existingNames = new Set((await listRoles()).map((r) => r.name));
  for (const role of manifest.roles) {
    if (existingNames.has(role.name)) { result.roles.skipped++; continue; }
    try {
      const created = await createRole(role.name, role.permissions);
      if (role.prompt) await updateRole(created.id, { prompt: role.prompt });
      result.roles.created++;
    } catch { result.roles.failed++; }
  }
}

async function importInvites(manifest: ExportManifest, result: ImportResult) {
  const [currentRoles, currentSkills, currentMcpServers, currentInvites] = await Promise.all([
    listRoles(), listSkills(), listMcpServers(), listInvites(),
  ]);
  const roleNameToId = new Map(currentRoles.map((r) => [r.name, r.id]));
  const skillNameToId = new Map(currentSkills.map((s) => [s.name, s.id]));
  const mcpNameToId = new Map(currentMcpServers.map((m) => [m.name, m.id]));
  const existingLabels = new Set(currentInvites.map((i) => i.label));

  for (const invite of manifest.invites) {
    if (existingLabels.has(invite.label)) { result.invites.skipped++; continue; }
    try {
      const params: Record<string, unknown> = {
        label: invite.label, prompt: invite.prompt, greeting: invite.greeting,
      };
      if (invite.max_uses !== null) params.max_uses = invite.max_uses;
      if (invite.max_messages_per_session !== null) params.max_messages_per_session = invite.max_messages_per_session;
      if (invite.role_name) {
        const roleId = roleNameToId.get(invite.role_name);
        if (roleId) params.role_id = roleId;
      }
      if (invite.skill_names.length > 0) {
        params.skill_ids = invite.skill_names.map((name) => skillNameToId.get(name)).filter(Boolean);
      }
      if (invite.mcp_server_names.length > 0) {
        params.mcp_server_ids = invite.mcp_server_names.map((name) => mcpNameToId.get(name)).filter(Boolean);
      }
      await createInvite(params as Parameters<typeof createInvite>[0]);
      result.invites.created++;
    } catch { result.invites.failed++; }
  }
}

async function importSettings(manifest: ExportManifest, result: ImportResult) {
  try {
    await updateSettings({
      public_access: manifest.settings.public_access,
      ai_system_prompt: manifest.settings.ai_system_prompt,
    });
    result.settings.updated++;
  } catch { result.settings.failed++; }
}

async function importAssets(manifest: ExportManifest, result: ImportResult, assetBuffers: Map<string, Buffer>) {
  const existingPaths = new Set((await listAssets()).map((a) => a.path));
  for (const asset of manifest.assets) {
    const buffer = assetBuffers.get(asset.path);
    if (!buffer) { result.assets.failed++; continue; }
    try {
      const filename = asset.path.split("/").pop() || "file";
      if (existingPaths.has(asset.path)) {
        const { deleteAsset: delAsset } = await import("./asset-api.js");
        await delAsset(asset.path);
      }
      await uploadAsset(buffer, filename, asset.path, asset.visibility);
      if (existingPaths.has(asset.path)) { result.assets.updated++; }
      else { result.assets.created++; }
    } catch { result.assets.failed++; }
  }
}
