import { useState, useEffect, useRef, useMemo } from "react";
import PageGenerationChat from "../components/PageGenerationChat";
import ResizeHandle from "../components/ResizeHandle";
import { useResizable } from "../hooks/useResizable";

interface PageFormState {
  name: string;
  description: string;
  roleId: string | null;
  metaTitle: string;
  metaDescription: string;
}

type Mode =
  | { type: "idle" }
  | { type: "view"; page: Page }
  | { type: "new" };

export interface PageEditorState {
  mode: Mode;
  setMode: (m: Mode) => void;
  setError: (e: string) => void;
  form: PageFormState;
  setForm: (f: PageFormState) => void;
  roles: Role[];
  loadPages: () => Promise<void>;
  mustUse: string[];
  dontUse: string[];
  onMustUseChange: (pkgs: string[]) => void;
  onDontUseChange: (pkgs: string[]) => void;
  onSelectionChange: (id: string | null, name: string | undefined) => void;
  gatewayUrl: string;
  ownerToken: string;
  webUrl: string;
  centerTab: "preview" | "code";
  setCenterTab: (tab: "preview" | "code") => void;
}

export function usePageActions(state: PageEditorState) {
  const { mode, setMode, setError, form, loadPages, mustUse, dontUse, onSelectionChange } = state;

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      setError("");
      const page = await window.standmeet.page.create({
        name: form.name.trim(), description: form.description,
        role_id: form.roleId, must_use: mustUse, dont_use: dontUse,
        meta: { title: form.metaTitle, description: form.metaDescription },
      });
      await loadPages();
      setMode({ type: "view", page });
      onSelectionChange(page.id, page.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page");
    }
  };

  const handleSave = async () => {
    if (mode.type !== "view") return;
    try {
      setError("");
      const updated = await window.standmeet.page.update(mode.page.id, {
        name: form.name.trim(), description: form.description,
        role_id: form.roleId, must_use: mustUse, dont_use: dontUse,
        meta: { title: form.metaTitle, description: form.metaDescription },
      });
      await loadPages();
      setMode({ type: "view", page: updated });
      onSelectionChange(updated.id, updated.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save page");
    }
  };

  const handleDelete = async () => {
    if (mode.type !== "view" || !confirm("Delete this page permanently?")) return;
    try {
      await window.standmeet.page.delete(mode.page.id);
      await loadPages();
      setMode({ type: "idle" });
      onSelectionChange(null, undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete page");
    }
  };

  const handleBuild = async () => {
    if (mode.type !== "view") return;
    try {
      setError("");
      await window.standmeet.page.build(mode.page.id);
      const page = await window.standmeet.page.get(mode.page.id);
      setMode({ type: "view", page });
      await loadPages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger build");
    }
  };

  const refreshPage = async () => {
    if (mode.type !== "view") return;
    try {
      const page = await window.standmeet.page.get(mode.page.id);
      setMode({ type: "view", page });
      await loadPages();
    } catch { /* ignore */ }
  };

  return { handleCreate, handleSave, handleDelete, handleBuild, refreshPage };
}

/* ── Sub-components ─────────────────────── */

function PageFormFields({ form, roles, mustUse, dontUse, globalPackages, onFormChange, onMustUseChange, onDontUseChange }: {
  form: PageFormState; roles: Role[];
  mustUse: string[]; dontUse: string[];
  globalPackages: GlobalPackage[];
  onFormChange: (f: PageFormState) => void;
  onMustUseChange: (pkgs: string[]) => void;
  onDontUseChange: (pkgs: string[]) => void;
}) {
  return (
    <>
      <div className="invite-detail-section">
        <div className="form-group">
          <label>Name</label>
          <input data-testid="page-name-input" type="text" value={form.name}
            onChange={(e) => onFormChange({ ...form, name: e.target.value })} placeholder="Page name" />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea data-testid="page-description-input" value={form.description}
            onChange={(e) => onFormChange({ ...form, description: e.target.value })}
            placeholder="What this page is about" rows={2} />
        </div>
      </div>
      <div className="invite-detail-section">
        <div className="invite-detail-section-header">
          <span className="invite-detail-section-title">Content & Build</span>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Role</label>
            <select data-testid="page-role-select" value={form.roleId ?? ""}
              onChange={(e) => onFormChange({ ...form, roleId: e.target.value || null })}>
              <option value="">None (all content)</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        <PackageRulesField
          mustUse={mustUse} dontUse={dontUse}
          globalPackages={globalPackages}
          onMustUseChange={onMustUseChange}
          onDontUseChange={onDontUseChange}
        />
      </div>
      <MetaFields form={form} onFormChange={onFormChange} />
    </>
  );
}

function PackageDropdown({ testId, selected, globalPackages, placeholder, onChange }: {
  testId: string;
  selected: string[];
  globalPackages: GlobalPackage[];
  placeholder: string;
  onChange: (pkgs: string[]) => void;
}) {
  const available = globalPackages.filter((p) => !selected.includes(p.name));

  return (
    <div className="tag-input-container" data-testid={testId}>
      {selected.map((pkg) => (
        <span key={pkg} className="page-package-tag">
          {pkg}
          <button className="tag-remove-btn" onClick={() => onChange(selected.filter((p) => p !== pkg))} title="Remove">&times;</button>
        </span>
      ))}
      {globalPackages.length === 0 ? (
        <span className="hint" style={{ fontSize: 12, padding: "4px 0" }}>
          No packages installed — go to the npm tab to install some first
        </span>
      ) : available.length > 0 ? (
        <select
          data-testid={`${testId}-select`}
          className="tag-input"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...selected, e.target.value]);
          }}
          style={{ minWidth: 150 }}
        >
          <option value="">{placeholder}</option>
          {available.map((p) => (
            <option key={p.name} value={p.name}>{p.name} ({p.version})</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function PackageRulesField({ mustUse, dontUse, globalPackages, onMustUseChange, onDontUseChange }: {
  mustUse: string[];
  dontUse: string[];
  globalPackages: GlobalPackage[];
  onMustUseChange: (pkgs: string[]) => void;
  onDontUseChange: (pkgs: string[]) => void;
}) {
  return (
    <>
      <div className="form-group">
        <label>Must Use Packages</label>
        <p className="hint" style={{ margin: "0 0 4px", fontSize: 12 }}>
          Extra packages to include (beyond globally installed ones)
        </p>
        <PackageDropdown
          testId="page-must-use"
          selected={mustUse}
          globalPackages={globalPackages}
          placeholder="Select package to include..."
          onChange={onMustUseChange}
        />
      </div>
      <div className="form-group">
        <label>Don't Use Packages</label>
        <p className="hint" style={{ margin: "0 0 4px", fontSize: 12 }}>
          Global packages to exclude from this page's build
        </p>
        <PackageDropdown
          testId="page-dont-use"
          selected={dontUse}
          globalPackages={globalPackages}
          placeholder="Select package to exclude..."
          onChange={onDontUseChange}
        />
      </div>
    </>
  );
}

function MetaFields({ form, onFormChange }: {
  form: PageFormState; onFormChange: (f: PageFormState) => void;
}) {
  return (
    <div className="invite-detail-section">
      <div className="invite-detail-section-header">
        <span className="invite-detail-section-title">SEO / Meta</span>
      </div>
      <div className="form-group">
        <label>Title</label>
        <input data-testid="page-meta-title-input" type="text" value={form.metaTitle}
          onChange={(e) => onFormChange({ ...form, metaTitle: e.target.value })}
          placeholder="Page title (for search engines & social sharing)" />
      </div>
      <div className="form-group">
        <label>Description</label>
        <textarea data-testid="page-meta-description-input" value={form.metaDescription}
          onChange={(e) => onFormChange({ ...form, metaDescription: e.target.value })}
          placeholder="Page description (for search engines & social sharing)" rows={2} />
      </div>
    </div>
  );
}

/* ── Center Area (Preview/Code tabs + bottom AI panel) ─────────────────────── */

export function PageCenterArea({ state, actions, error }: {
  state: PageEditorState;
  actions: ReturnType<typeof usePageActions>;
  error?: string;
}) {
  const { mode, webUrl, centerTab, setCenterTab, gatewayUrl, ownerToken, form } = state;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [devReady, setDevReady] = useState(false);
  const activatedRef = useRef<string | null>(null);

  const bottomPanel = useResizable({
    defaultWidth: 280,
    minWidth: 150,
    maxWidth: 600,
    reverse: true,
    direction: "vertical",
    storageKey: "page-bottom-panel-height",
  });

  // Activate page for dev preview when selected
  useEffect(() => {
    if (mode.type !== "view") {
      activatedRef.current = null;
      setDevReady(false);
      return;
    }
    if (activatedRef.current === mode.page.id) return;

    activatedRef.current = mode.page.id;
    setDevReady(false);
    window.standmeet.page.activate(mode.page.id)
      .then(() => setDevReady(true))
      .catch(() => {
        // Still mark as ready even on error so UI isn't stuck on "Loading..."
        setDevReady(true);
      });
  }, [mode]);

  const statusBadge = (status: string) => {
    const cls = status === "ready" ? "connected" : status === "failed" ? "disconnected" : "";
    return <span className={`status-badge ${cls}`}>{status}</span>;
  };

  // Dev preview uses Vite dev server; published URL uses web server
  const devPreviewUrl = "http://localhost:5173";
  const publishedUrl = mode.type === "view" ? `${webUrl}/api/pages/${mode.page.id}` : "";

  const handleRefreshPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = devPreviewUrl + "?t=" + Date.now();
    }
  };

  // Tabs available in center area
  const centerTabs = mode.type === "view"
    ? [
        { key: "preview" as const, label: "Preview" },
        { key: "code" as const, label: "Code" },
      ]
    : [{ key: "preview" as const, label: "Preview" }];

  const activeCenter = centerTabs.some((t) => t.key === centerTab) ? centerTab : "preview";

  return (
    <div className="page-main-area">
      {error && <div className="alert error" style={{ margin: "8px 12px 0" }}>{error}</div>}

      {/* Toolbar */}
      <div className="page-preview-toolbar">
        {/* Center tabs */}
        <div className="page-center-tabs">
          {centerTabs.map((t) => (
            <button
              key={t.key}
              className={`page-center-tab-btn ${activeCenter === t.key ? "active" : ""}`}
              onClick={() => setCenterTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        {mode.type === "new" ? (
          <button data-testid="page-create-btn" className="small primary" onClick={actions.handleCreate}>Create</button>
        ) : mode.type === "view" ? (
          <>
            <button data-testid="page-save-btn" className="small primary" onClick={actions.handleSave} title="Save page settings">Save</button>
            <button data-testid="page-build-btn" className="small" onClick={actions.handleBuild}
              disabled={mode.page.status === "building"} title="Publish page (SSG build for production)">
              {mode.page.status === "building" ? "Publishing..." : "Publish"}
            </button>
            <button data-testid="page-delete-btn" className="small danger" onClick={actions.handleDelete} title="Delete this page permanently">Delete</button>
            {statusBadge(mode.page.status)}
            <button className="small" onClick={handleRefreshPreview} title="Refresh preview">↻</button>
            {mode.page.status === "ready" && webUrl && (
              <a className="small button-link" href={publishedUrl} target="_blank" rel="noopener noreferrer"
                data-testid="page-preview-btn" title="Open published page in browser">↗</a>
            )}
          </>
        ) : null}
      </div>

      {/* Center content area (upper) */}
      <div className="page-center-content">
        {activeCenter === "preview" && (
          <div className="page-preview-body">
            {mode.type === "new" ? (
              <div className="editor-empty">
                <p>Fill in the page details and click Create</p>
              </div>
            ) : mode.type === "view" && devReady && Object.keys(mode.page.source_files ?? {}).length > 0 ? (
              <iframe
                ref={iframeRef}
                src={devPreviewUrl}
                className="page-preview-iframe"
                title="Page preview"
                data-testid="page-preview"
              />
            ) : mode.type === "view" && mode.page.status === "ready" && webUrl ? (
              <iframe
                ref={iframeRef}
                src={publishedUrl}
                className="page-preview-iframe"
                title="Page preview"
                data-testid="page-preview"
              />
            ) : mode.type === "view" && mode.page.status === "building" ? (
              <div className="editor-empty">
                <p>Publishing...</p>
                <p className="hint">The page is being built. Refresh to check status.</p>
              </div>
            ) : mode.type === "view" && Object.keys(mode.page.source_files ?? {}).length === 0 ? (
              <div className="editor-empty">
                <p>No source files yet</p>
                <p className="hint">Use AI Chat below to generate code, then preview will update automatically.</p>
              </div>
            ) : mode.type === "view" ? (
              <div className="editor-empty">
                <p>Publish to see preview</p>
                <p className="hint">Click "Publish" to generate the page and see a preview here.</p>
              </div>
            ) : null}
          </div>
        )}

        {activeCenter === "code" && mode.type === "view" && (
          <PageCodeViewer sourceFiles={mode.page.source_files ?? {}} />
        )}
      </div>

      {/* Bottom panel (AI Chat) — only for "view" mode with gateway */}
      {mode.type === "view" && gatewayUrl && (
        <>
          <ResizeHandle onMouseDown={bottomPanel.onMouseDown} direction="vertical" />
          <div
            className={`page-bottom-panel ${bottomCollapsed ? "collapsed" : ""}`}
            style={{ height: bottomCollapsed ? 36 : bottomPanel.size }}
          >
            <div className="page-bottom-panel-header">
              <span className="page-bottom-panel-title">AI Chat</span>
              <button
                className="page-bottom-panel-toggle"
                onClick={() => setBottomCollapsed(!bottomCollapsed)}
                title={bottomCollapsed ? "Expand" : "Collapse"}
              >
                {bottomCollapsed ? "▲" : "▼"}
              </button>
            </div>
            {!bottomCollapsed && (
              <div className="page-bottom-panel-content">
                <PageGenerationChat
                  key={mode.page.id}
                  gatewayUrl={gatewayUrl}
                  ownerToken={ownerToken}
                  pageId={mode.page.id}
                  roleId={form.roleId}
                  packages={state.mustUse}
                  onFilesWritten={actions.refreshPage}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Code Viewer ─────────────────────── */

function PageCodeViewer({ sourceFiles }: { sourceFiles: Record<string, string> }) {
  const fileNames = useMemo(() => Object.keys(sourceFiles), [sourceFiles]);
  const [activeFile, setActiveFile] = useState(fileNames[0] ?? "");

  useEffect(() => {
    if (!fileNames.includes(activeFile) && fileNames.length > 0) {
      setActiveFile(fileNames[0]);
    }
  }, [fileNames, activeFile]);

  if (fileNames.length === 0) {
    return (
      <div className="editor-empty">
        <p>No source files</p>
        <p className="hint">Use AI to generate code, or build the page to see source files here.</p>
      </div>
    );
  }

  return (
    <div className="page-code-viewer">
      <div className="page-code-file-list">
        {fileNames.map((f) => (
          <button
            key={f}
            className={`page-code-file-item ${f === activeFile ? "active" : ""}`}
            onClick={() => setActiveFile(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="page-code-content">
        <pre><code>{sourceFiles[activeFile] ?? ""}</code></pre>
      </div>
    </div>
  );
}

/* ── Right Panel (Settings only) ─────────────────────── */

export function PageRightPanel({ state, actions }: {
  state: PageEditorState;
  actions: ReturnType<typeof usePageActions>;
}) {
  const { mode, form, setForm, roles, mustUse, dontUse, onMustUseChange, onDontUseChange } = state;

  const [globalPackages, setGlobalPackages] = useState<GlobalPackage[]>([]);

  useEffect(() => {
    window.standmeet.package.list()
      .then(setGlobalPackages)
      .catch(() => {});
  }, [mode]);

  return (
    <>
      <div className="page-right-tab-content" data-testid="page-editor">
        <PageFormFields
          form={form} roles={roles}
          mustUse={mustUse} dontUse={dontUse}
          globalPackages={globalPackages}
          onFormChange={setForm}
          onMustUseChange={onMustUseChange}
          onDontUseChange={onDontUseChange}
        />

        {/* Build log section at bottom of settings */}
        {mode.type === "view" && mode.page.status !== "draft" && (
          <div className="invite-detail-section" style={{ marginTop: 16 }}>
            <div className="invite-detail-section-header">
              <span className="invite-detail-section-title">Build Log</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                <span className={`status-badge ${mode.page.status === "ready" ? "connected" : mode.page.status === "failed" ? "disconnected" : ""}`}>
                  {mode.page.status}
                </span>
                <button className="small" onClick={actions.refreshPage}>Refresh</button>
              </div>
            </div>
            <pre className="build-log" data-testid="page-build-log">{mode.page.build_log || "(no log yet)"}</pre>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Legacy default export ─────────────────────── */

export default function PageEditorPane({ state }: { state: PageEditorState }) {
  const actions = usePageActions(state);

  return (
    <div style={{ display: "contents" }}>
      <PageCenterArea state={state} actions={actions} />
    </div>
  );
}
