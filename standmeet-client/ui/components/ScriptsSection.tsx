import { useState } from "react";
import type { SkillScript } from "../../src/types";

function ScriptItem({ script, isViewing, onToggleView }: {
  script: SkillScript; isViewing: boolean; onToggleView: () => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border, #ddd)", borderRadius: 4, padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>{script.filename}</span>
          <span className="iam-badge" style={{ fontSize: 10 }}>{script.language}</span>
        </div>
        <button className="small" onClick={onToggleView}>
          {isViewing ? "Hide" : "View"}
        </button>
      </div>
      {script.description && <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{script.description}</p>}
      {script.parameters.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 12 }}>
          <span className="muted">Parameters: </span>
          {script.parameters.map((p) => (
            <span key={p.name} className="iam-badge" style={{ fontSize: 10, marginRight: 4 }}>
              {p.name}{p.type ? `: ${p.type}` : ""}
            </span>
          ))}
        </div>
      )}
      {isViewing && (
        <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontSize: 12, background: "var(--bg-secondary, #f5f5f5)", padding: 8, borderRadius: 4, maxHeight: 300, overflow: "auto" }}>
          {script.content}
        </pre>
      )}
    </div>
  );
}

export default function ScriptsSection({ scripts }: { scripts: SkillScript[] }) {
  const [expanded, setExpanded] = useState(false);
  const [viewScript, setViewScript] = useState<string | null>(null);

  if (scripts.length === 0) return null;

  return (
    <div className="form-group">
      <button
        className="small"
        onClick={() => { setExpanded(!expanded); setViewScript(null); }}
        style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "flex-start", padding: "4px 0", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
      >
        <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>&#9654;</span>
        Scripts ({scripts.length})
      </button>
      {expanded && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {scripts.map((script) => (
            <ScriptItem key={script.filename} script={script}
              isViewing={viewScript === script.filename}
              onToggleView={() => setViewScript(viewScript === script.filename ? null : script.filename)} />
          ))}
        </div>
      )}
    </div>
  );
}
