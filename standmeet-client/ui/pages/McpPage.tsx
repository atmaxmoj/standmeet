import { useState, useEffect } from "react";
import { Download, Upload } from "lucide-react";
import ResizeHandle from "../components/ResizeHandle";
import { useResizable } from "../hooks/useResizable";

type Selection =
  | { type: "builtin" }
  | { type: "custom"; id: string }
  | { type: "create" }
  | null;

function useMcpData() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [editName, setEditName] = useState("");
  const [editConfig, setEditConfig] = useState("");
  const [saving, setSaving] = useState(false);

  const loadServers = async () => {
    try {
      setLoading(true);
      const data = await window.standmeet.mcpServer.list();
      setServers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load MCP servers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadServers(); }, []);

  const selectedServer = selection?.type === "custom"
    ? servers.find((s) => s.id === selection.id) ?? null
    : null;

  useEffect(() => {
    if (selectedServer) {
      setEditName(selectedServer.name);
      setEditConfig(JSON.stringify(selectedServer.config, null, 2));
    }
  }, [selection?.type === "custom" ? (selection as { id: string }).id : null]);

  const handleCreate = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    setError("");
    try {
      let config = {};
      if (editConfig.trim()) config = JSON.parse(editConfig);
      const server = await window.standmeet.mcpServer.create(editName.trim(), config);
      setEditName("");
      setEditConfig("");
      await loadServers();
      setSelection({ type: "custom", id: server.id });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create MCP server");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedServer) return;
    setSaving(true);
    setError("");
    try {
      let config: Record<string, unknown> | undefined;
      if (editConfig.trim()) config = JSON.parse(editConfig);
      await window.standmeet.mcpServer.update(selectedServer.id, { name: editName.trim(), config });
      await loadServers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save MCP server");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedServer || !confirm("Delete this MCP server?")) return;
    setError("");
    try {
      await window.standmeet.mcpServer.delete(selectedServer.id);
      setSelection(null);
      await loadServers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete MCP server");
    }
  };

  return {
    servers, loading, error, selection, setSelection,
    selectedServer, editName, setEditName, editConfig, setEditConfig,
    saving, loadServers, handleCreate, handleSave, handleDelete,
  };
}

function McpSidebar({
  state, width,
}: {
  state: ReturnType<typeof useMcpData>;
  width: number;
}) {
  return (
    <div className="iam-sidebar" style={{ width }}>
      <div className="iam-sidebar-header">
        <h3>MCP Servers</h3>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button className="small primary" onClick={() => {
            state.setSelection({ type: "create" });
            state.setEditName("");
            state.setEditConfig("");
          }}>
            + New
          </button>
          <button className="icon-btn" title="Import"
            onClick={async () => { await window.standmeet.data.importCategoryFromFile("mcp_servers"); state.loadServers(); }}>
            <Upload size={14} />
          </button>
          <button className="icon-btn" data-testid="mcp-export-all-btn" title="Export All"
            onClick={() => window.standmeet.data.exportCategoryToFile("mcp_servers")}>
            <Download size={14} />
          </button>
        </div>
      </div>
      {state.error && <div className="alert error iam-error">{state.error}</div>}
      {state.loading ? (
        <p className="muted" style={{ padding: "12px" }}>Loading...</p>
      ) : (
        <ul className="iam-role-list">
          <li>
            <button
              className={`iam-role-item ${state.selection?.type === "builtin" ? "active" : ""}`}
              onClick={() => state.setSelection({ type: "builtin" })}
            >
              <span className="iam-role-name">
                StandMeet
                <span className="iam-badge">built-in</span>
              </span>
              <span className="iam-role-count">3 tools</span>
            </button>
          </li>
          {state.servers.map((server) => (
            <li key={server.id}>
              <button
                className={`iam-role-item ${state.selection?.type === "custom" && state.selection.id === server.id ? "active" : ""}`}
                onClick={() => state.setSelection({ type: "custom", id: server.id })}
              >
                <span className="iam-role-name">{server.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BuiltinPanel() {
  return (
    <div className="iam-edit-panel">
      <h3>StandMeet (Built-in)</h3>
      <p className="hint" style={{ marginTop: 4, marginBottom: 16 }}>
        The built-in MCP server provides access to your content. It is always available and cannot be modified.
      </p>
      <div className="form-group">
        <label>Tools</label>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li><code>list_content</code> &mdash; List available content entries</li>
          <li><code>read_content</code> &mdash; Read a specific content entry</li>
          <li><code>search_content</code> &mdash; Search content by keyword</li>
        </ul>
      </div>
    </div>
  );
}

function CreatePanel({ state }: { state: ReturnType<typeof useMcpData> }) {
  return (
    <div className="iam-edit-panel">
      <h3>Add MCP Server</h3>
      <div className="form-group">
        <label htmlFor="mcp-name">Name</label>
        <input id="mcp-name" value={state.editName}
          onChange={(e) => state.setEditName(e.target.value)}
          placeholder="e.g. my-tool" autoFocus />
      </div>
      <McpConfigField editConfig={state.editConfig} setEditConfig={state.setEditConfig} />
      <div className="button-row">
        <button className="primary" onClick={state.handleCreate}
          disabled={state.saving || !state.editName.trim()}>
          {state.saving ? "Creating..." : "Create"}
        </button>
        <button className="small" onClick={() => state.setSelection(null)}>Cancel</button>
      </div>
    </div>
  );
}

function EditPanel({ state }: { state: ReturnType<typeof useMcpData> }) {
  return (
    <div className="iam-edit-panel">
      <div className="form-group">
        <label htmlFor="mcp-name">Name</label>
        <input id="mcp-name" value={state.editName}
          onChange={(e) => state.setEditName(e.target.value)} />
      </div>
      <McpConfigField editConfig={state.editConfig} setEditConfig={state.setEditConfig} />
      <div className="button-row">
        <button className="primary" onClick={state.handleSave}
          disabled={state.saving || !state.editName.trim()}>
          {state.saving ? "Saving..." : "Save"}
        </button>
        <button onClick={() => {
          if (!state.selectedServer) return;
          const data = { name: state.selectedServer.name, config: state.selectedServer.config };
          window.standmeet.data.saveJsonToFile(data, `mcp-server-${state.selectedServer.name}`);
        }}>
          Export
        </button>
        <button className="danger" onClick={state.handleDelete}>Delete</button>
      </div>
    </div>
  );
}

function McpConfigField({
  editConfig, setEditConfig,
}: {
  editConfig: string;
  setEditConfig: (v: string) => void;
}) {
  return (
    <div className="form-group">
      <label htmlFor="mcp-config">Config (JSON)</label>
      <textarea id="mcp-config" value={editConfig}
        onChange={(e) => setEditConfig(e.target.value)}
        rows={10}
        placeholder='{"type": "http", "url": "https://..."}'
        style={{ fontFamily: "monospace", fontSize: 13 }} />
    </div>
  );
}

function McpDetailPane({ state }: { state: ReturnType<typeof useMcpData> }) {
  if (state.selection?.type === "builtin") return <BuiltinPanel />;
  if (state.selection?.type === "create") return <CreatePanel state={state} />;
  if (state.selectedServer) return <EditPanel state={state} />;

  return (
    <div className="iam-empty">
      <p>Select an MCP server to view details</p>
      <p className="hint">or click <strong>+ New</strong> to add a custom MCP server</p>
    </div>
  );
}

export default function McpPage() {
  const sidebar = useResizable({ defaultWidth: 280, minWidth: 180, maxWidth: 480 });
  const state = useMcpData();

  return (
    <div className="iam-page">
      <McpSidebar state={state} width={sidebar.width} />
      <ResizeHandle onMouseDown={sidebar.onMouseDown} />
      <div className="iam-detail">
        <McpDetailPane state={state} />
      </div>
    </div>
  );
}
