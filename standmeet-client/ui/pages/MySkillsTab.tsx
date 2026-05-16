import { useState, useEffect } from "react";
import { Download, Upload } from "lucide-react";
import type { Skill } from "../../src/types";
import ResizeHandle from "../components/ResizeHandle";
import ScriptsSection from "../components/ScriptsSection";
import { useResizable } from "../hooks/useResizable";

function SourceBadge({ source }: { source: string }) {
  if (source === "manual") return null;
  return <span className="iam-badge">{source === "import" ? "imported" : source}</span>;
}

function UpdateBadge({ skill }: { skill: Skill }) {
  if (skill.source !== "marketplace" || !skill.latest_known_version || !skill.installed_version) return null;
  if (skill.latest_known_version === skill.installed_version) return null;
  return <span className="iam-badge" style={{ background: "#e67e22", color: "#fff" }}>update</span>;
}

type Selection =
  | { type: "builtin"; id: string }
  | { type: "custom"; id: string }
  | { type: "create" }
  | null;

interface SkillHandlerDeps {
  selectedSkill: Skill | null;
  editName: string; editDescription: string; editPrompt: string;
  showRaw: boolean;
  setEditName: (v: string) => void; setEditDescription: (v: string) => void; setEditPrompt: (v: string) => void;
  setSaving: (v: boolean) => void; setError: (v: string) => void;
  setSelection: (s: Selection) => void;
  setShowRaw: (v: boolean) => void; setRawContent: (v: string) => void;
  loadSkills: () => Promise<void>;
}

function createSkillHandlers(deps: SkillHandlerDeps) {
  const { selectedSkill, editName, editDescription, editPrompt, showRaw } = deps;
  const { setEditName, setEditDescription, setEditPrompt, setSaving, setError } = deps;
  const { setSelection, setShowRaw, setRawContent, loadSkills } = deps;

  const handleCreate = async () => {
    if (!editName.trim()) return;
    setSaving(true); setError("");
    try {
      const skill = await window.standmeet.skill.create(editName.trim(), editDescription.trim(), editPrompt.trim());
      setEditName(""); setEditDescription(""); setEditPrompt("");
      await loadSkills();
      setSelection({ type: "custom", id: skill.id });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create skill");
    } finally { setSaving(false); }
  };

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSaving(true); setError("");
    try {
      await window.standmeet.skill.update(selectedSkill.id, { name: editName.trim(), description: editDescription.trim(), prompt: editPrompt.trim() });
      await loadSkills();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save skill");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selectedSkill || !confirm("Delete this skill?")) return;
    setError("");
    try {
      await window.standmeet.skill.delete(selectedSkill.id);
      setSelection(null);
      await loadSkills();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete skill");
    }
  };

  const handleImportFile = async () => {
    setError("");
    try {
      const skill = await window.standmeet.skill.importFile();
      if (skill) { await loadSkills(); setSelection({ type: "custom", id: skill.id }); }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import skill");
    }
  };

  const handleExport = async () => {
    if (!selectedSkill) return;
    setError("");
    try {
      const md = await window.standmeet.skill.export(selectedSkill.id);
      setRawContent(md); setShowRaw(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export skill");
    }
  };

  const handleToggleRaw = async () => {
    if (showRaw) { setShowRaw(false); return; }
    if (!selectedSkill) return;
    try {
      const md = await window.standmeet.skill.export(selectedSkill.id);
      setRawContent(md); setShowRaw(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load SKILL.md");
    }
  };

  return { handleCreate, handleSave, handleDelete, handleImportFile, handleExport, handleToggleRaw };
}

function useSkillData() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [rawContent, setRawContent] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSkills = async () => {
    try {
      setLoading(true);
      const data = await window.standmeet.skill.list();
      setSkills(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSkills(); }, []);

  const builtinSkills = skills.filter((s) => s.is_builtin);
  const customSkills = skills.filter((s) => !s.is_builtin);

  const selectedSkill =
    selection?.type === "builtin" || selection?.type === "custom"
      ? skills.find((s) => s.id === selection.id) ?? null
      : null;

  useEffect(() => {
    if (selectedSkill && selection?.type === "custom") {
      setEditName(selectedSkill.name);
      setEditDescription(selectedSkill.description);
      setEditPrompt(selectedSkill.prompt);
    }
    setShowRaw(false);
    setRawContent("");
  }, [selection?.type === "custom" || selection?.type === "builtin" ? (selection as { id: string }).id : null]);

  const handlers = createSkillHandlers({
    selectedSkill, editName, editDescription, editPrompt, showRaw,
    setEditName, setEditDescription, setEditPrompt, setSaving, setError,
    setSelection, setShowRaw, setRawContent, loadSkills,
  });

  return {
    skills, builtinSkills, customSkills, loading, error,
    showRaw, rawContent, selection, setSelection,
    selectedSkill, editName, setEditName,
    editDescription, setEditDescription,
    editPrompt, setEditPrompt, saving,
    ...handlers,
  };
}

function SkillSidebar({ state, width }: {
  state: ReturnType<typeof useSkillData>; width: number;
}) {
  return (
    <div className="iam-sidebar" style={{ width }}>
      <div className="iam-sidebar-header">
        <h3>My Skills</h3>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button data-testid="skill-new-btn" className="small primary"
            onClick={() => { state.setSelection({ type: "create" }); state.setEditName(""); state.setEditDescription(""); state.setEditPrompt(""); }}>
            + New
          </button>
          <button className="icon-btn" title="Import" onClick={state.handleImportFile}><Upload size={14} /></button>
          <button className="icon-btn" data-testid="skill-export-all-btn" title="Export All"
            onClick={() => window.standmeet.data.exportCategoryToFile("skills")}><Download size={14} /></button>
        </div>
      </div>
      {state.error && <div className="alert error iam-error">{state.error}</div>}
      {state.loading ? (
        <p className="muted" style={{ padding: "12px" }}>Loading...</p>
      ) : (
        <ul className="iam-role-list">
          {state.builtinSkills.map((skill) => (
            <li key={skill.id}>
              <button className={`iam-role-item ${state.selection?.type === "builtin" && state.selection.id === skill.id ? "active" : ""}`}
                onClick={() => state.setSelection({ type: "builtin", id: skill.id })}>
                <span className="iam-role-name">{skill.name}<span className="iam-badge">built-in</span></span>
              </button>
            </li>
          ))}
          {state.customSkills.map((skill) => (
            <li key={skill.id}>
              <button className={`iam-role-item ${state.selection?.type === "custom" && state.selection.id === skill.id ? "active" : ""}`}
                onClick={() => state.setSelection({ type: "custom", id: skill.id })}>
                <span className="iam-role-name">
                  {skill.name}
                  <SourceBadge source={skill.source} />
                  <UpdateBadge skill={skill} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BuiltinSkillPanel({ state }: { state: ReturnType<typeof useSkillData> }) {
  const skill = state.selectedSkill!;
  return (
    <div className="iam-edit-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{skill.name}<span className="iam-badge" style={{ marginLeft: 8, verticalAlign: "middle" }}>built-in</span></h3>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="small" onClick={state.handleToggleRaw}>{state.showRaw ? "Form View" : "SKILL.md"}</button>
          <button className="small" onClick={state.handleExport}>Export</button>
        </div>
      </div>
      {state.showRaw ? (
        <div className="form-group" style={{ marginTop: 12 }}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13, background: "var(--bg-secondary, #f5f5f5)", padding: 12, borderRadius: 4 }}>{state.rawContent}</pre>
        </div>
      ) : (
        <>
          <div className="form-group"><label>Description</label><p style={{ margin: 0 }}>{skill.description || <span className="muted">No description</span>}</p></div>
          <div className="form-group"><label>Prompt</label><pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>{skill.prompt || <span className="muted">No prompt</span>}</pre></div>
          {skill.version && <div className="form-group"><label>Version</label><p style={{ margin: 0 }}>{skill.version}</p></div>}
        </>
      )}
      {skill.scripts?.length > 0 && <ScriptsSection scripts={skill.scripts} />}
      <p className="hint" style={{ marginTop: 12 }}>Built-in skills cannot be modified or deleted.</p>
    </div>
  );
}

function CreateSkillPanel({ state }: { state: ReturnType<typeof useSkillData> }) {
  return (
    <div className="iam-edit-panel">
      <h3>Add Skill</h3>
      <div className="form-group"><label htmlFor="skill-name">Name</label><input id="skill-name" data-testid="skill-name" value={state.editName} onChange={(e) => state.setEditName(e.target.value)} placeholder="e.g. Code Review" autoFocus /></div>
      <div className="form-group"><label htmlFor="skill-description">Description</label><input id="skill-description" data-testid="skill-description" value={state.editDescription} onChange={(e) => state.setEditDescription(e.target.value)} placeholder="Brief description of what this skill does" /></div>
      <div className="form-group"><label htmlFor="skill-prompt">Prompt</label><textarea id="skill-prompt" data-testid="skill-prompt" value={state.editPrompt} onChange={(e) => state.setEditPrompt(e.target.value)} rows={8} placeholder="System prompt instructions for this skill..." style={{ fontFamily: "monospace", fontSize: 13 }} /></div>
      <div className="button-row">
        <button data-testid="skill-create-btn" className="primary" onClick={state.handleCreate} disabled={state.saving || !state.editName.trim()}>{state.saving ? "Creating..." : "Create"}</button>
        <button className="small" onClick={() => state.setSelection(null)}>Cancel</button>
      </div>
    </div>
  );
}

function EditSkillPanel({ state }: { state: ReturnType<typeof useSkillData> }) {
  const skill = state.selectedSkill!;
  return (
    <div className="iam-edit-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SourceBadge source={skill.source} />
          <UpdateBadge skill={skill} />
          {skill.version && <span className="muted" style={{ fontSize: 12 }}>v{skill.version}</span>}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="small" onClick={state.handleToggleRaw}>{state.showRaw ? "Form View" : "SKILL.md"}</button>
          <button className="small" onClick={state.handleExport}>Export</button>
        </div>
      </div>
      {state.showRaw ? (
        <div className="form-group"><pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13, background: "var(--bg-secondary, #f5f5f5)", padding: 12, borderRadius: 4 }}>{state.rawContent}</pre></div>
      ) : (
        <>
          <div className="form-group"><label htmlFor="skill-name">Name</label><input id="skill-name" data-testid="skill-name" value={state.editName} onChange={(e) => state.setEditName(e.target.value)} /></div>
          <div className="form-group"><label htmlFor="skill-description">Description</label><input id="skill-description" data-testid="skill-description" value={state.editDescription} onChange={(e) => state.setEditDescription(e.target.value)} /></div>
          <div className="form-group"><label htmlFor="skill-prompt">Prompt</label><textarea id="skill-prompt" data-testid="skill-prompt" value={state.editPrompt} onChange={(e) => state.setEditPrompt(e.target.value)} rows={8} style={{ fontFamily: "monospace", fontSize: 13 }} /></div>
          {skill.allowed_tools.length > 0 && <div className="form-group"><label>Allowed Tools</label><p style={{ margin: 0 }}>{skill.allowed_tools.join(", ")}</p></div>}
          {skill.license && <div className="form-group"><label>License</label><p style={{ margin: 0 }}>{skill.license}</p></div>}
          {skill.scripts?.length > 0 && <ScriptsSection scripts={skill.scripts} />}
        </>
      )}
      <div className="button-row">
        <button data-testid="skill-save-btn" className="primary" onClick={state.handleSave} disabled={state.saving || !state.editName.trim()}>{state.saving ? "Saving..." : "Save"}</button>
        <button data-testid="skill-delete-btn" className="danger" onClick={state.handleDelete}>Delete</button>
      </div>
    </div>
  );
}

function SkillDetailPane({ state }: { state: ReturnType<typeof useSkillData> }) {
  if (state.selection?.type === "builtin" && state.selectedSkill) return <BuiltinSkillPanel state={state} />;
  if (state.selection?.type === "create") return <CreateSkillPanel state={state} />;
  if (state.selectedSkill && state.selection?.type === "custom") return <EditSkillPanel state={state} />;
  return (
    <div className="iam-empty">
      <p>Select a skill to view details</p>
      <p className="hint">or click <strong>+ New</strong> to create, or <strong>Import</strong> a SKILL.md file</p>
    </div>
  );
}

export default function MySkillsTab() {
  const sidebar = useResizable({ defaultWidth: 280, minWidth: 180, maxWidth: 480 });
  const state = useSkillData();

  return (
    <div className="iam-page" style={{ flex: 1 }}>
      <SkillSidebar state={state} width={sidebar.width} />
      <ResizeHandle onMouseDown={sidebar.onMouseDown} />
      <div className="iam-detail">
        <SkillDetailPane state={state} />
      </div>
    </div>
  );
}
