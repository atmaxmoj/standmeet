import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("standmeet", {
  config: {
    load: () => ipcRenderer.invoke("config:load"),
    save: (config: unknown) => ipcRenderer.invoke("config:save", config),
    isConfigured: () => ipcRenderer.invoke("config:isConfigured"),
  },
  content: {
    list: (prefix?: string) => ipcRenderer.invoke("content:list", prefix),
    read: (path: string) => ipcRenderer.invoke("content:read", path),
    create: (path: string, content: unknown, summary?: string, visibility?: string, showAsSource?: boolean) =>
      ipcRenderer.invoke("content:create", path, content, summary, visibility, showAsSource),
    update: (path: string, content: unknown, summary?: string, visibility?: string, showAsSource?: boolean) =>
      ipcRenderer.invoke("content:update", path, content, summary, visibility, showAsSource),
    delete: (path: string) => ipcRenderer.invoke("content:delete", path),
  },
  role: {
    create: (name: string, permissions: unknown) =>
      ipcRenderer.invoke("role:create", name, permissions),
    list: () => ipcRenderer.invoke("role:list"),
    get: (id: string) => ipcRenderer.invoke("role:get", id),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("role:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("role:delete", id),
  },
  invite: {
    create: (params: unknown) => ipcRenderer.invoke("invite:create", params),
    list: () => ipcRenderer.invoke("invite:list"),
    update: (code: string, data: unknown) =>
      ipcRenderer.invoke("invite:update", code, data),
    revoke: (code: string) => ipcRenderer.invoke("invite:revoke", code),
    delete: (code: string) => ipcRenderer.invoke("invite:delete", code),
    chatLogs: (code: string) => ipcRenderer.invoke("invite:chatLogs", code),
    deleteChatLog: (code: string, logId: string) =>
      ipcRenderer.invoke("invite:deleteChatLog", code, logId),
    clearChatLogs: (code: string) =>
      ipcRenderer.invoke("invite:clearChatLogs", code),
    saveSummary: (code: string, sessionId: string, summary: string) =>
      ipcRenderer.invoke("invite:saveSummary", code, sessionId, summary),
  },
  asset: {
    list: (prefix?: string) => ipcRenderer.invoke("asset:list", prefix),
    get: (path: string) => ipcRenderer.invoke("asset:get", path),
    upload: (assetPath: string, visibility?: string) =>
      ipcRenderer.invoke("asset:upload", assetPath, visibility),
    uploadDirect: (filePath: string, assetPath: string, visibility?: string) =>
      ipcRenderer.invoke("asset:uploadDirect", filePath, assetPath, visibility),
    updateVisibility: (path: string, visibility: string) =>
      ipcRenderer.invoke("asset:updateVisibility", path, visibility),
    delete: (path: string) => ipcRenderer.invoke("asset:delete", path),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (settings: unknown) =>
      ipcRenderer.invoke("settings:update", settings),
  },
  status: {
    get: () => ipcRenderer.invoke("status:get"),
  },
  mcpServer: {
    create: (name: string, config: unknown) =>
      ipcRenderer.invoke("mcpServer:create", name, config),
    list: () => ipcRenderer.invoke("mcpServer:list"),
    get: (id: string) => ipcRenderer.invoke("mcpServer:get", id),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("mcpServer:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("mcpServer:delete", id),
  },
  skill: {
    create: (name: string, description: string, prompt: string) =>
      ipcRenderer.invoke("skill:create", name, description, prompt),
    list: () => ipcRenderer.invoke("skill:list"),
    get: (id: string) => ipcRenderer.invoke("skill:get", id),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("skill:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("skill:delete", id),
    import: (skillMdRaw: string) =>
      ipcRenderer.invoke("skill:import", skillMdRaw),
    importFile: () => ipcRenderer.invoke("skill:importFile"),
    importUrl: (url: string) => ipcRenderer.invoke("skill:importUrl", url),
    export: (id: string) => ipcRenderer.invoke("skill:export", id),
  },
  marketplace: {
    search: (query?: string, source?: string) =>
      ipcRenderer.invoke("marketplace:search", query, source),
    detail: (marketplace: string, skillId: string) =>
      ipcRenderer.invoke("marketplace:detail", marketplace, skillId),
    install: (marketplace: string, skillId: string) =>
      ipcRenderer.invoke("marketplace:install", marketplace, skillId),
    checkUpdates: () => ipcRenderer.invoke("marketplace:checkUpdates"),
  },
  page: {
    list: () => ipcRenderer.invoke("page:list"),
    get: (id: string) => ipcRenderer.invoke("page:get", id),
    create: (data: unknown) => ipcRenderer.invoke("page:create", data),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("page:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("page:delete", id),
    build: (id: string) => ipcRenderer.invoke("page:build", id),
    buildLog: (id: string) => ipcRenderer.invoke("page:buildLog", id),
    activate: (id: string) => ipcRenderer.invoke("page:activate", id),
  },
  storage: {
    usage: () => ipcRenderer.invoke("storage:usage"),
  },
  package: {
    list: () => ipcRenderer.invoke("package:list"),
    install: (name: string) => ipcRenderer.invoke("package:install", name),
    uninstall: (name: string) => ipcRenderer.invoke("package:uninstall", name),
  },
  data: {
    exportToFile: () => ipcRenderer.invoke("data:exportToFile"),
    exportCategoryToFile: (category: string) =>
      ipcRenderer.invoke("data:exportCategoryToFile", category),
    importCategoryFromFile: (category: string) =>
      ipcRenderer.invoke("data:importCategoryFromFile", category),
    loadImportFile: () => ipcRenderer.invoke("data:loadImportFile"),
    executeImport: (filePath: string, selected: unknown) =>
      ipcRenderer.invoke("data:executeImport", filePath, selected),
    exportDirect: () => ipcRenderer.invoke("data:exportDirect"),
    importDirect: (json: string, selected: unknown) =>
      ipcRenderer.invoke("data:importDirect", json, selected),
    exportCategoryDirect: (category: string) =>
      ipcRenderer.invoke("data:exportCategoryDirect", category),
    importCategoryDirect: (category: string, data: unknown) =>
      ipcRenderer.invoke("data:importCategoryDirect", category, data),
    saveJsonToFile: (data: unknown, defaultName: string) =>
      ipcRenderer.invoke("data:saveJsonToFile", data, defaultName),
  },
  npm: {
    search: (query: string) => ipcRenderer.invoke("npm:search", query),
    readme: (name: string) => ipcRenderer.invoke("npm:readme", name),
  },
  mcp: {
    connectClaudeCode: () => ipcRenderer.invoke("mcp:connectClaudeCode"),
    connectClaudeDesktop: () => ipcRenderer.invoke("mcp:connectClaudeDesktop"),
    checkClaudeCode: () => ipcRenderer.invoke("mcp:checkClaudeCode"),
    checkClaudeDesktop: () => ipcRenderer.invoke("mcp:checkClaudeDesktop"),
  },
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  onMenuNew: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("menu:new", handler);
    return () => {
      ipcRenderer.removeListener("menu:new", handler);
    };
  },
});
