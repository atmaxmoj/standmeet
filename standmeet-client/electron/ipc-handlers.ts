import { dialog, ipcMain } from "electron";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  buildExportData,
  buildCategoryExportData,
  importData,
  importCategoryData,
} from "../src/api/data-io.js";
import type { ExportCategory } from "../src/api/data-io.js";
import type { ExportManifest } from "../src/types.js";
import { readZipManifest, readZipFull } from "./zip-helpers.js";
import {
  listContent, readContent, createContent, updateContent, deleteContent,
} from "../src/api/content-api.js";
import {
  createInvite, listInvites, updateInvite, revokeInvite, deleteInvite,
  listChatLogs, deleteChatLog, clearChatLogs, saveChatSessionSummary,
} from "../src/api/invite-api.js";
import { createRole, listRoles, getRole, updateRole, deleteRole } from "../src/api/role-api.js";
import {
  createMcpServer, listMcpServers, getMcpServer, updateMcpServer, deleteMcpServer,
} from "../src/api/mcp-server-api.js";
import {
  createSkill, listSkills, getSkill, updateSkill, deleteSkill,
  importSkillMd, importSkillZip, exportSkillMd, importSkillFromUrl,
} from "../src/api/skill-api.js";
import { getSettings, updateSettings, getStatus } from "../src/api/settings-api.js";
import {
  searchMarketplace, getMarketplaceDetail, installFromMarketplace, checkUpdates,
} from "../src/api/marketplace-api.js";
import {
  listAssets, getAsset, uploadAsset, updateAssetVisibility, deleteAsset,
} from "../src/api/asset-api.js";
import {
  listGlobalPackages, installPackage, uninstallPackage,
} from "../src/api/package-api.js";
import {
  listPages, getPage, createPage, updatePage, deletePage,
  triggerBuild, getBuildLog, getStorageUsage, activatePage,
} from "../src/api/page-api.js";
import { loadConfig, saveConfig, isConfigured } from "../src/config/manager.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function registerCoreHandlers() {
  ipcMain.handle("config:load", () => loadConfig());
  ipcMain.handle("config:save", (_e, config) => { saveConfig(config); return true; });
  ipcMain.handle("config:isConfigured", () => isConfigured());

  ipcMain.handle("content:list", (_e, prefix?: string) => listContent(prefix));
  ipcMain.handle("content:read", (_e, p: string) => readContent(p));
  ipcMain.handle("content:create",
    (_e, p: string, content: Record<string, unknown>, summary?: string, visibility?: "private" | "public", showAsSource?: boolean) =>
      createContent(p, content, summary, visibility, showAsSource));
  ipcMain.handle("content:update",
    (_e, p: string, content: Record<string, unknown>, summary?: string, visibility?: "private" | "public", showAsSource?: boolean) =>
      updateContent(p, content, summary, visibility, showAsSource));
  ipcMain.handle("content:delete", (_e, p: string) => deleteContent(p));

  ipcMain.handle("role:create", (_e, name: string, permissions) => createRole(name, permissions));
  ipcMain.handle("role:list", () => listRoles());
  ipcMain.handle("role:get", (_e, id: string) => getRole(id));
  ipcMain.handle("role:update", (_e, id: string, data) => updateRole(id, data));
  ipcMain.handle("role:delete", (_e, id: string) => deleteRole(id));

  ipcMain.handle("invite:create", (_e, params) => createInvite(params));
  ipcMain.handle("invite:list", () => listInvites());
  ipcMain.handle("invite:update", (_e, code: string, data) => updateInvite(code, data));
  ipcMain.handle("invite:revoke", (_e, code: string) => revokeInvite(code));
  ipcMain.handle("invite:delete", (_e, code: string) => deleteInvite(code));
  ipcMain.handle("invite:chatLogs", (_e, code: string) => listChatLogs(code));
  ipcMain.handle("invite:deleteChatLog", (_e, code: string, logId: string) => deleteChatLog(code, logId));
  ipcMain.handle("invite:clearChatLogs", (_e, code: string) => clearChatLogs(code));
  ipcMain.handle("invite:saveSummary", (_e, code: string, sessionId: string, summary: string) =>
    saveChatSessionSummary(code, sessionId, summary));
}

function registerMcpAndSkillHandlers() {
  ipcMain.handle("mcpServer:create", (_e, name: string, config: Record<string, unknown>) => createMcpServer(name, config));
  ipcMain.handle("mcpServer:list", () => listMcpServers());
  ipcMain.handle("mcpServer:get", (_e, id: string) => getMcpServer(id));
  ipcMain.handle("mcpServer:update", (_e, id: string, data: { name?: string; config?: Record<string, unknown> }) => updateMcpServer(id, data));
  ipcMain.handle("mcpServer:delete", (_e, id: string) => deleteMcpServer(id));

  ipcMain.handle("skill:create", (_e, name: string, description: string, prompt: string) => createSkill(name, description, prompt));
  ipcMain.handle("skill:list", () => listSkills());
  ipcMain.handle("skill:get", (_e, id: string) => getSkill(id));
  ipcMain.handle("skill:update", (_e, id: string, data: { name?: string; description?: string; prompt?: string }) => updateSkill(id, data));
  ipcMain.handle("skill:delete", (_e, id: string) => deleteSkill(id));
  ipcMain.handle("skill:import", (_e, skillMdRaw: string) => importSkillMd(skillMdRaw));
  ipcMain.handle("skill:importFile", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import SKILL.md or ZIP",
      filters: [
        { name: "Skill files", extensions: ["md", "zip"] },
        { name: "SKILL.md files", extensions: ["md"] },
        { name: "ZIP archives", extensions: ["zip"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    if (filePath.toLowerCase().endsWith(".zip")) {
      const buffer = readFileSync(filePath);
      return importSkillZip(buffer as unknown as Buffer, path.basename(filePath));
    }
    const content = readFileSync(filePath, "utf-8");
    return importSkillMd(content);
  });
  ipcMain.handle("skill:export", (_e, id: string) => exportSkillMd(id));
  ipcMain.handle("skill:importUrl", (_e, url: string) => importSkillFromUrl(url));

  ipcMain.handle("marketplace:search", (_e, query?: string, source?: string) => searchMarketplace(query, source));
  ipcMain.handle("marketplace:detail", (_e, marketplace: string, skillId: string) => getMarketplaceDetail(marketplace, skillId));
  ipcMain.handle("marketplace:install", (_e, marketplace: string, skillId: string) => installFromMarketplace(marketplace, skillId));
  ipcMain.handle("marketplace:checkUpdates", () => checkUpdates());
}

function registerAssetAndPageHandlers() {
  ipcMain.handle("asset:list", (_e, prefix?: string) => listAssets(prefix));
  ipcMain.handle("asset:get", (_e, p: string) => getAsset(p));
  ipcMain.handle("asset:upload", async (_e, assetPath: string, visibility?: "private" | "public") => {
    const result = await dialog.showOpenDialog({ title: "Select file to upload", properties: ["openFile"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const buffer = readFileSync(filePath);
    const filename = path.basename(filePath);
    return uploadAsset(Buffer.from(buffer), filename, assetPath, visibility ?? "private");
  });
  ipcMain.handle("asset:uploadDirect", (_e, filePath: string, assetPath: string, visibility?: "private" | "public") => {
    const buffer = readFileSync(filePath);
    const filename = path.basename(filePath);
    return uploadAsset(Buffer.from(buffer), filename, assetPath, visibility ?? "private");
  });
  ipcMain.handle("asset:updateVisibility", (_e, p: string, visibility: "private" | "public") => updateAssetVisibility(p, visibility));
  ipcMain.handle("asset:delete", (_e, p: string) => deleteAsset(p));

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:update", (_e, settings) => updateSettings(settings));
  ipcMain.handle("status:get", () => getStatus());

  ipcMain.handle("page:list", () => listPages());
  ipcMain.handle("page:get", (_e, id: string) => getPage(id));
  ipcMain.handle("page:create", (_e, data) => createPage(data));
  ipcMain.handle("page:update", (_e, id: string, data) => updatePage(id, data));
  ipcMain.handle("page:delete", (_e, id: string) => deletePage(id));
  ipcMain.handle("page:build", (_e, id: string) => triggerBuild(id));
  ipcMain.handle("page:buildLog", (_e, id: string) => getBuildLog(id));
  ipcMain.handle("page:activate", (_e, id: string) => activatePage(id));
  ipcMain.handle("storage:usage", () => getStorageUsage());

  ipcMain.handle("package:list", () => listGlobalPackages());
  ipcMain.handle("package:install", (_e, name: string) => installPackage(name));
  ipcMain.handle("package:uninstall", (_e, name: string) => uninstallPackage(name));

  ipcMain.handle("npm:search", async (_e, query: string) => {
    const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`);
    if (res.status === 429) throw new Error("npm rate limit exceeded, please try again later");
    if (!res.ok) throw new Error("npm search failed");
    const data = await res.json();
    return (data.objects as Array<{ package: { name: string; version: string; description?: string } }>).map((o) => ({
      name: o.package.name, version: o.package.version, description: o.package.description || "",
    }));
  });

  ipcMain.handle("npm:readme", async (_e, name: string) => {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { readme: data.readme || "", description: data.description || "", homepage: data.homepage || "" };
  });
}

function registerDataHandlers() {
  ipcMain.handle("data:exportToFile", async () => {
    const manifest = await buildExportData();
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Export All StandMeet Data",
      defaultPath: `standmeet-export-${date}.json`,
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, JSON.stringify(manifest, null, 2));
    return result.filePath;
  });

  ipcMain.handle("data:exportCategoryToFile", async (_e, category: string) => {
    const data = await buildCategoryExportData(category as ExportCategory);
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: `Export ${category}`,
      defaultPath: `standmeet-${category}-${date}.json`,
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return result.filePath;
  });

  ipcMain.handle("data:loadImportFile", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import StandMeet Data",
      filters: [{ name: "JSON or ZIP", extensions: ["json", "zip"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    if (filePath.toLowerCase().endsWith(".zip")) {
      const { manifest, hasAssets } = readZipManifest(filePath);
      return { manifest, hasAssets, zipPath: filePath };
    }
    const manifest = JSON.parse(readFileSync(filePath, "utf-8")) as ExportManifest;
    return { manifest, hasAssets: false, zipPath: filePath };
  });

  ipcMain.handle("data:executeImport", async (_e, filePath: string, selected: Record<string, boolean>) => {
    if (filePath.toLowerCase().endsWith(".zip")) {
      const { manifest, assetBuffers } = readZipFull(filePath);
      return importData(manifest, selected as Parameters<typeof importData>[1], assetBuffers);
    }
    const manifest = JSON.parse(readFileSync(filePath, "utf-8")) as ExportManifest;
    return importData(manifest, selected as Parameters<typeof importData>[1]);
  });

  ipcMain.handle("data:exportDirect", async () => {
    const manifest = await buildExportData();
    return { manifest, json: JSON.stringify(manifest) };
  });

  ipcMain.handle("data:importDirect", async (_e, jsonStr: string, selected: Record<string, boolean>) => {
    const manifest = JSON.parse(jsonStr) as ExportManifest;
    return importData(manifest, selected as Parameters<typeof importData>[1]);
  });

  ipcMain.handle("data:exportCategoryDirect", async (_e, category: string) => {
    return buildCategoryExportData(category as ExportCategory);
  });

  ipcMain.handle("data:importCategoryDirect", async (_e, category: string, data: unknown) => {
    const normalized = category === "settings" ? data : (Array.isArray(data) ? data : [data]);
    return importCategoryData(category as ExportCategory, normalized);
  });

  ipcMain.handle("data:importCategoryFromFile", async (_e, category: string) => {
    const result = await dialog.showOpenDialog({
      title: `Import ${category}`,
      filters: [{ name: "JSON Files", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const data = JSON.parse(readFileSync(result.filePaths[0], "utf-8"));
    const normalized = category === "settings" ? data : (Array.isArray(data) ? data : [data]);
    return importCategoryData(category as ExportCategory, normalized);
  });

  ipcMain.handle("data:saveJsonToFile", async (_e, data: unknown, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: "Export",
      defaultPath: `${defaultName}.json`,
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return result.filePath;
  });
}

function registerMcpConfigHandlers() {
  ipcMain.handle("mcp:connectClaudeCode", () => {
    const configDir = path.join(homedir(), ".claude");
    const configPath = path.join(configDir, "settings.json");
    const serverArgs = [path.join(__dirname, "../dist/index.js")];
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, "utf-8"));
    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers["standmeet"] = { command: "node", args: serverArgs };
    config.mcpServers = mcpServers;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    return configPath;
  });

  ipcMain.handle("mcp:checkClaudeCode", () => {
    const configPath = path.join(homedir(), ".claude", "settings.json");
    if (!existsSync(configPath)) return null;
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const entry = config?.mcpServers?.standmeet;
      if (!entry) return null;
      const expectedArgs = [path.join(__dirname, "../dist/index.js")];
      const stale = JSON.stringify(entry.args) !== JSON.stringify(expectedArgs);
      return { path: configPath, stale };
    } catch { return null; }
  });

  ipcMain.handle("mcp:checkClaudeDesktop", () => {
    const configPath = path.join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    if (!existsSync(configPath)) return null;
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const entry = config?.mcpServers?.standmeet;
      if (!entry) return null;
      const expectedArgs = [path.join(__dirname, "../dist/index.js")];
      const stale = JSON.stringify(entry.args) !== JSON.stringify(expectedArgs);
      return { path: configPath, stale };
    } catch { return null; }
  });

  ipcMain.handle("mcp:connectClaudeDesktop", () => {
    const configDir = path.join(homedir(), "Library", "Application Support", "Claude");
    const configPath = path.join(configDir, "claude_desktop_config.json");
    const serverArgs = [path.join(__dirname, "../dist/index.js")];
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, "utf-8"));
    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers["standmeet"] = { command: "node", args: serverArgs };
    config.mcpServers = mcpServers;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    return configPath;
  });
}

export function registerIpcHandlers() {
  registerCoreHandlers();
  registerMcpAndSkillHandlers();
  registerAssetAndPageHandlers();
  registerDataHandlers();
  registerMcpConfigHandlers();
}
