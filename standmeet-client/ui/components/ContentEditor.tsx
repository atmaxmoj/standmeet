import { useState } from "react";

interface Props {
  path: string;
  content: Record<string, unknown>;
  summary: string;
  visibility: "private" | "public";
  showAsSource: boolean;
  onSave: (
    path: string,
    content: Record<string, unknown>,
    summary?: string,
    visibility?: "private" | "public",
    showAsSource?: boolean,
  ) => Promise<void>;
  onDelete?: () => void;
  isNew?: boolean;
}

function extractText(content: Record<string, unknown>): string {
  if (typeof content.body === "string") return content.body;
  if (typeof content.text === "string") return content.text;
  if (Object.keys(content).length === 0) return "";
  return JSON.stringify(content, null, 2);
}

function EditorHeader({
  path, text, summaryVal, vis, source,
  onDelete, saving, onSave,
}: {
  path: string; text: string; summaryVal: string;
  vis: "private" | "public"; source: boolean;
  onDelete?: () => void; saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="editor-header">
      <h3>{path}</h3>
      <div className="button-row">
        {onDelete && (
          <button data-testid="editor-delete" className="small danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <button
          className="small"
          onClick={() => {
            const data = { path, content: { body: text }, summary: summaryVal, visibility: vis, show_as_source: source };
            window.standmeet.data.saveJsonToFile(data, `content-${path.replace(/\//g, "-").replace(/^-/, "")}`);
          }}
        >
          Export
        </button>
        <button
          data-testid="editor-save"
          className="small primary"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function VisibilityToggles({
  vis, source, onVisChange, onSourceChange,
}: {
  vis: "private" | "public"; source: boolean;
  onVisChange: (v: "private" | "public") => void;
  onSourceChange: (s: boolean) => void;
}) {
  return (
    <div className="form-group toggles">
      <div className="toggle-row">
        <input
          type="checkbox"
          id="toggle-public"
          data-testid="editor-public"
          checked={vis === "public"}
          onChange={(e) => onVisChange(e.target.checked ? "public" : "private")}
        />
        <label htmlFor="toggle-public">Public</label>
        <span className="hint-trigger">
          ?
          <span className="hint-tooltip">BYOAI visitors can see this content</span>
        </span>
      </div>
      <div className="toggle-row">
        <input
          type="checkbox"
          id="toggle-source"
          data-testid="editor-source"
          checked={source}
          onChange={(e) => onSourceChange(e.target.checked)}
        />
        <label htmlFor="toggle-source">Show as source</label>
        <span className="hint-trigger">
          ?
          <span className="hint-tooltip">Show as a cited source in AI replies. AI can still use this content, just won't show it as a reference.</span>
        </span>
      </div>
    </div>
  );
}

export default function ContentEditor({
  path: initialPath,
  content,
  summary,
  visibility,
  showAsSource,
  onSave,
  onDelete,
}: Props) {
  const [text, setText] = useState(extractText(content));
  const [summaryVal, setSummaryVal] = useState(summary);
  const [vis, setVis] = useState<"private" | "public">(visibility);
  const [source, setSource] = useState(showAsSource);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setError("");
    setSaving(true);
    try {
      await onSave(initialPath, { body: text }, summaryVal || undefined, vis, source);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor">
      <EditorHeader
        path={initialPath}
        text={text}
        summaryVal={summaryVal}
        vis={vis}
        source={source}
        onDelete={onDelete}
        saving={saving}
        onSave={handleSave}
      />
      <div className="form-group">
        <label htmlFor="summary">Summary</label>
        <input
          id="summary"
          data-testid="editor-summary"
          value={summaryVal}
          onChange={(e) => setSummaryVal(e.target.value)}
          placeholder="Brief description"
        />
      </div>
      <VisibilityToggles
        vis={vis}
        source={source}
        onVisChange={setVis}
        onSourceChange={setSource}
      />
      <div className="form-group grow">
        <label>Content</label>
        <textarea
          data-testid="editor-content"
          className="code-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="Write anything here..."
        />
      </div>
      {error && <div className="alert error">{error}</div>}
    </div>
  );
}
