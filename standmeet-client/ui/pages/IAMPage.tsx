import { useState, useEffect } from "react";
import { Download, Upload } from "lucide-react";
import PathPicker from "../components/PathPicker";
import ResizeHandle from "../components/ResizeHandle";
import { useResizable } from "../hooks/useResizable";

interface PermissionDraft {
  action: "allow" | "deny";
  path_pattern: string;
}

function useIAMData() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPerms, setEditPerms] = useState<PermissionDraft[]>([]);
  const [editPrompt, setEditPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const loadRoles = async () => {
    try {
      setLoading(true);
      const data = await window.standmeet.role.list();
      setRoles(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRoles(); }, []);

  const selectedRole = roles.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedRole) {
      setEditName(selectedRole.name);
      setEditPerms(selectedRole.permissions.map((p) => ({
        action: p.action, path_pattern: p.path_pattern,
      })));
      setEditPrompt(selectedRole.prompt);
    }
  }, [selectedId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError("");
    try {
      const role = await window.standmeet.role.create(newName.trim(), []);
      setNewName("");
      setCreating(false);
      await loadRoles();
      setSelectedId(role.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create role");
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    try {
      const permissions = editPerms
        .filter((p) => p.path_pattern.trim())
        .map((p, i) => ({ action: p.action, path_pattern: p.path_pattern.trim(), order: i }));
      await window.standmeet.role.update(selectedId, { name: editName, permissions, prompt: editPrompt });
      await loadRoles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !confirm("Delete this role?")) return;
    setError("");
    try {
      await window.standmeet.role.delete(selectedId);
      setSelectedId(null);
      await loadRoles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete role");
    }
  };

  const sortedRoles = [...roles].sort((a, b) => {
    if (a.name === "public") return -1;
    if (b.name === "public") return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    roles, sortedRoles, loading, error, selectedId, setSelectedId,
    selectedRole, editName, setEditName, editPerms, setEditPerms,
    editPrompt, setEditPrompt, saving, creating, setCreating,
    newName, setNewName, loadRoles,
    handleCreate, handleSave, handleDelete,
  };
}

function RoleSidebar({
  state, width, onMouseDown,
}: {
  state: ReturnType<typeof useIAMData>;
  width: number;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <>
      <div className="iam-sidebar" style={{ width }}>
        <div className="iam-sidebar-header">
          <h3>Roles</h3>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button data-testid="iam-new-btn" className="small primary"
              onClick={() => state.setCreating(!state.creating)}>
              {state.creating ? "Cancel" : "+ New"}
            </button>
            <button className="icon-btn" title="Import"
              onClick={async () => { await window.standmeet.data.importCategoryFromFile("roles"); state.loadRoles(); }}>
              <Upload size={14} />
            </button>
            <button className="icon-btn" data-testid="iam-export-all-btn" title="Export All"
              onClick={() => window.standmeet.data.exportCategoryToFile("roles")}>
              <Download size={14} />
            </button>
          </div>
        </div>
        {state.creating && (
          <div className="iam-create-form">
            <input data-testid="iam-new-name" value={state.newName}
              onChange={(e) => state.setNewName(e.target.value)}
              placeholder="Role name"
              onKeyDown={(e) => e.key === "Enter" && state.handleCreate()}
              autoFocus />
            <button className="small primary" onClick={state.handleCreate}>Create</button>
          </div>
        )}
        {state.error && <div className="alert error iam-error">{state.error}</div>}
        {state.loading ? (
          <p className="muted" style={{ padding: "12px" }}>Loading...</p>
        ) : (
          <ul className="iam-role-list">
            {state.sortedRoles.map((role) => (
              <li key={role.id}>
                <button
                  className={`iam-role-item ${state.selectedId === role.id ? "active" : ""}`}
                  onClick={() => state.setSelectedId(role.id)}
                >
                  <span className="iam-role-name">
                    {role.name}
                    {role.name === "public" && <span className="iam-badge">built-in</span>}
                  </span>
                  <span className="iam-role-count">{role.permissions.length} rules</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ResizeHandle onMouseDown={onMouseDown} />
    </>
  );
}

function RoleEditPanel({ state }: { state: ReturnType<typeof useIAMData> }) {
  const { selectedRole, editName, setEditName, editPerms, setEditPerms,
    editPrompt, setEditPrompt, saving, handleSave, handleDelete } = state;

  if (!selectedRole) {
    return <div className="iam-empty"><p>Select a role to edit</p></div>;
  }

  const isPublicRole = selectedRole.name === "public";

  return (
    <div className="iam-edit-panel">
      <div className="form-group">
        <label htmlFor="role-name">Name</label>
        <input id="role-name" data-testid="iam-edit-name" value={editName}
          onChange={(e) => setEditName(e.target.value)} disabled={isPublicRole} />
      </div>
      <PermissionsSection editPerms={editPerms} setEditPerms={setEditPerms} />
      <div className="form-group">
        <label htmlFor="role-prompt">Prompt</label>
        <textarea id="role-prompt" data-testid="iam-prompt" value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)} rows={3}
          placeholder="Custom system prompt for this role" />
      </div>
      <div className="button-row">
        <button data-testid="iam-save" className="primary" onClick={handleSave}
          disabled={saving || !editName.trim()}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button data-testid="iam-export" onClick={() => {
          if (!selectedRole) return;
          const data = { name: selectedRole.name, permissions: selectedRole.permissions, prompt: selectedRole.prompt };
          window.standmeet.data.saveJsonToFile(data, `role-${selectedRole.name}`);
        }}>
          Export
        </button>
        {!isPublicRole && (
          <button data-testid="iam-delete" className="danger" onClick={handleDelete}>Delete Role</button>
        )}
      </div>
    </div>
  );
}

function PermissionsSection({
  editPerms, setEditPerms,
}: {
  editPerms: PermissionDraft[];
  setEditPerms: (perms: PermissionDraft[]) => void;
}) {
  return (
    <div className="permissions-section">
      <div className="permissions-header">
        <label>Permission Rules</label>
        <button data-testid="iam-add-rule" className="small"
          onClick={() => setEditPerms([...editPerms, { action: "allow", path_pattern: "" }])}>
          + Add Rule
        </button>
      </div>
      {editPerms.map((perm, idx) => (
        <div key={idx} className="permission-rule-row">
          <select data-testid={`iam-rule-action-${idx}`} value={perm.action}
            onChange={(e) => {
              const updated = [...editPerms];
              updated[idx] = { ...perm, action: e.target.value as "allow" | "deny" };
              setEditPerms(updated);
            }}>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
          <PathPicker testId={`iam-rule-path-${idx}`} value={perm.path_pattern}
            onChange={(val) => {
              const updated = [...editPerms];
              updated[idx] = { ...perm, path_pattern: val };
              setEditPerms(updated);
            }} />
          <button type="button" className="small danger permission-remove"
            onClick={() => setEditPerms(editPerms.filter((_, i) => i !== idx))}>
            ✕
          </button>
        </div>
      ))}
      {editPerms.length === 0 && (
        <p className="empty-message">No rules. All paths will be denied.</p>
      )}
    </div>
  );
}

export default function IAMPage() {
  const roleSidebar = useResizable({ defaultWidth: 280, minWidth: 180, maxWidth: 480 });
  const state = useIAMData();

  return (
    <div className="iam-page">
      <RoleSidebar state={state} width={roleSidebar.width} onMouseDown={roleSidebar.onMouseDown} />
      <div className="iam-detail">
        <RoleEditPanel state={state} />
      </div>
    </div>
  );
}
