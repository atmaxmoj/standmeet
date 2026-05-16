import { useState, useEffect, useCallback } from "react";
import { Download, Upload } from "lucide-react";
import FileTree from "../components/FileTree";
import ContentEditor from "../components/ContentEditor";
import ResizeHandle from "../components/ResizeHandle";
import { useResizable } from "../hooks/useResizable";

type Mode =
  | { type: "idle" }
  | { type: "view"; entry: ContentEntry }
  | { type: "naming"; prefix: string }
  | { type: "new-file"; path: string };

interface ContentPageProps {
  initialPath?: string | null;
}

function useContentData(initialPath?: string | null) {
  const [items, setItems] = useState<ContentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>({ type: "idle" });
  const [inputValue, setInputValue] = useState("");

  const selectedPath = mode.type === "view" ? mode.entry.path : mode.type === "new-file" ? mode.path : null;

  const loadItems = async () => {
    try {
      setLoading(true);
      const data = await window.standmeet.content.list();
      setItems(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load content");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadItems(); }, []);

  const handleSelect = async (path: string) => {
    try {
      setError("");
      const entry = await window.standmeet.content.read(path);
      setMode({ type: "view", entry });
    } catch {
      setMode({ type: "new-file", path });
    }
  };

  useEffect(() => {
    if (initialPath) handleSelect(initialPath);
  }, [initialPath]);

  const handleSave = async (
    path: string,
    content: Record<string, unknown>,
    summary?: string,
    visibility?: "private" | "public",
    showAsSource?: boolean,
  ) => {
    if (mode.type === "new-file") {
      await window.standmeet.content.create(path, content, summary, visibility, showAsSource);
    } else {
      await window.standmeet.content.update(path, content, summary, visibility, showAsSource);
    }
    await loadItems();
    const entry = await window.standmeet.content.read(path);
    setMode({ type: "view", entry });
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`Delete "${path}"?`)) return;
    try {
      await window.standmeet.content.delete(path);
      setMode({ type: "idle" });
      await loadItems();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete content");
    }
  };

  const handleInputKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const name = inputValue.trim();
      if (!name || mode.type !== "naming") return;
      const prefix = mode.prefix === "/" ? "/" : mode.prefix;
      const fullPath = prefix + name.replace(/^\/+/, "");
      try {
        setError("");
        await window.standmeet.content.create(fullPath, { body: "" });
        await loadItems();
        const entry = await window.standmeet.content.read(fullPath);
        setMode({ type: "view", entry });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create");
      }
    }
    if (e.key === "Escape") setMode({ type: "idle" });
  };

  return {
    items, loading, error, mode, setMode, inputValue, setInputValue,
    selectedPath, loadItems, handleSelect, handleSave, handleDelete,
    handleInputKeyDown,
  };
}

function useMenuNew(
  selectedPath: string | null,
  items: ContentListItem[],
  setInputValue: (v: string) => void,
  setMode: (m: Mode) => void,
) {
  useEffect(() => {
    return window.standmeet.onMenuNew(() => {
      setInputValue("");
      if (selectedPath) {
        const isFolder = items.some(item =>
          item.path !== selectedPath && item.path.startsWith(selectedPath + "/")
        );
        if (isFolder) {
          setMode({ type: "naming", prefix: selectedPath + "/" });
        } else {
          const lastSlash = selectedPath.lastIndexOf("/");
          const parent = lastSlash > 0 ? selectedPath.substring(0, lastSlash + 1) : "/";
          setMode({ type: "naming", prefix: parent });
        }
      } else {
        setMode({ type: "naming", prefix: "/" });
      }
    });
  }, [selectedPath, items, setInputValue, setMode]);
}

export default function ContentPage({ initialPath }: ContentPageProps) {
  const explorer = useResizable({ defaultWidth: 260, minWidth: 160, maxWidth: 480 });
  const data = useContentData(initialPath);

  useMenuNew(data.selectedPath, data.items, data.setInputValue, data.setMode);

  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) el.focus();
  }, []);

  const handleNewClick = () => {
    data.setInputValue("");
    data.setMode({ type: "naming", prefix: "/" });
  };

  const handleCreateAt = (prefix: string) => {
    data.setInputValue("");
    data.setMode({ type: "naming", prefix });
  };

  return (
    <div className="page content-page">
      <ContentSidebar
        width={explorer.width}
        loading={data.loading}
        items={data.items}
        selectedPath={data.selectedPath}
        mode={data.mode}
        inputValue={data.inputValue}
        inputRef={inputRef}
        onSelect={data.handleSelect}
        onCreateAt={handleCreateAt}
        onNewClick={handleNewClick}
        onInputChange={data.setInputValue}
        onInputKeyDown={data.handleInputKeyDown}
        onInputBlur={() => { if (!data.inputValue.trim()) data.setMode({ type: "idle" }); }}
        onImport={async () => { await window.standmeet.data.importCategoryFromFile("content"); data.loadItems(); }}
      />
      <ResizeHandle onMouseDown={explorer.onMouseDown} />
      <div className="content-editor-pane">
        {data.error && <div className="alert error">{data.error}</div>}
        {data.mode.type === "new-file" ? (
          <ContentEditor
            key={"new-" + data.mode.path}
            path={data.mode.path}
            content={{}}
            summary=""
            visibility="private"
            showAsSource={true}
            onSave={data.handleSave}
            isNew
          />
        ) : data.mode.type === "view" ? (
          <ContentEditor
            key={data.mode.entry.path}
            path={data.mode.entry.path}
            content={data.mode.entry.content}
            summary={data.mode.entry.summary}
            visibility={data.mode.entry.visibility}
            showAsSource={data.mode.entry.show_as_source}
            onSave={data.handleSave}
            onDelete={() => data.handleDelete(data.mode.type === "view" ? data.mode.entry.path : "")}
          />
        ) : (
          <div className="editor-empty">
            <p>Select a file to edit</p>
            <p className="hint">
              Press <kbd>Cmd+N</kbd> to create new content
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ContentSidebar({
  width, loading, items, selectedPath, mode,
  inputValue, inputRef,
  onSelect, onCreateAt, onNewClick, onInputChange,
  onInputKeyDown, onInputBlur, onImport,
}: {
  width: number; loading: boolean;
  items: ContentListItem[]; selectedPath: string | null;
  mode: Mode; inputValue: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onSelect: (path: string) => void;
  onCreateAt: (prefix: string) => void;
  onNewClick: () => void;
  onInputChange: (v: string) => void;
  onInputKeyDown: (e: React.KeyboardEvent) => void;
  onInputBlur: () => void;
  onImport: () => void;
}) {
  return (
    <div className="content-sidebar" style={{ width }}>
      <div className="content-sidebar-header">
        <span className="content-sidebar-title">EXPLORER</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            data-testid="content-import-btn"
            className="tree-action-btn"
            title="Import"
            onClick={onImport}
          >
            <Upload size={14} />
          </button>
          <button
            data-testid="content-export-all-btn"
            className="tree-action-btn"
            title="Export All"
            onClick={() => window.standmeet.data.exportCategoryToFile("content")}
          >
            <Download size={14} />
          </button>
          <button
            data-testid="content-new-btn"
            className="tree-action-btn"
            title="New (Cmd+N)"
            onClick={onNewClick}
          >
            +
          </button>
        </div>
      </div>
      {loading ? (
        <p className="muted tree-empty">Loading...</p>
      ) : (
        <FileTree
          items={items}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onCreateAt={onCreateAt}
          naming={mode.type === "naming" ? {
            prefix: mode.prefix,
            value: inputValue,
            onChange: onInputChange,
            onKeyDown: onInputKeyDown,
            onBlur: onInputBlur,
            inputRef,
            placeholder: mode.prefix === "/" ? "path/to/file" : "filename",
          } : null}
        />
      )}
    </div>
  );
}
