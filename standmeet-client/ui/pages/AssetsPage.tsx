import { useState, useEffect, useCallback, useRef } from "react";
import { Download } from "lucide-react";
import FileTree from "../components/FileTree";
import type { NamingState } from "../components/FileTree";
import AssetDetail from "../components/AssetDetail";
import ResizeHandle from "../components/ResizeHandle";
import { useResizable } from "../hooks/useResizable";

type Mode =
  | { type: "idle" }
  | { type: "naming"; prefix: string };

function useAssetData() {
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [error, setError] = useState("");

  const loadAssets = useCallback(async () => {
    try {
      setLoading(true);
      const list = await window.standmeet.asset.list();
      setAssets(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load assets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  const handleSelect = useCallback(async (path: string) => {
    setSelectedPath(path);
    const asset = assets.find((a) => a.path === path);
    if (asset) {
      try {
        setError("");
        const detail = await window.standmeet.asset.get(path);
        setSelectedAsset(detail);
      } catch {
        setError("Failed to load asset details");
        setSelectedAsset(null);
      }
    } else {
      setSelectedAsset(null);
    }
  }, [assets]);

  const handleVisibilityChange = useCallback(async (visibility: "private" | "public") => {
    if (!selectedAsset) return;
    try {
      const updated = await window.standmeet.asset.updateVisibility(selectedAsset.path, visibility);
      setSelectedAsset({ ...selectedAsset, visibility: updated.visibility });
      await loadAssets();
      setError("");
    } catch {
      setError("Failed to update visibility");
    }
  }, [selectedAsset, loadAssets]);

  const handleDelete = useCallback(async () => {
    if (!selectedAsset) return;
    try {
      await window.standmeet.asset.delete(selectedAsset.path);
      setSelectedAsset(null);
      setSelectedPath(null);
      setError("");
      await loadAssets();
    } catch {
      setError("Failed to delete asset");
    }
  }, [selectedAsset, loadAssets]);

  return {
    assets, loading, selectedPath, setSelectedPath,
    selectedAsset, setSelectedAsset, error, setError,
    loadAssets, handleSelect, handleVisibilityChange, handleDelete,
  };
}

function useFileDrop(
  data: ReturnType<typeof useAssetData>,
) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    data.setError("");
    let lastUploaded: Asset | null = null;

    let dir = "/";
    if (data.selectedPath) {
      const isFile = data.assets.some((a) => a.path === data.selectedPath);
      if (isFile) {
        const lastSlash = data.selectedPath.lastIndexOf("/");
        dir = lastSlash > 0 ? data.selectedPath.substring(0, lastSlash + 1) : "/";
      } else {
        dir = data.selectedPath + "/";
      }
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = window.standmeet.getFilePath(file);
      if (!filePath) {
        data.setError("Could not read file path");
        return;
      }
      const filename = file.name;
      const assetPath = dir === "/" ? `/${filename}` : `${dir}${filename}`;
      try {
        lastUploaded = await window.standmeet.asset.uploadDirect(filePath, assetPath);
      } catch (err) {
        data.setError(err instanceof Error ? err.message : "Upload failed");
        return;
      }
    }

    await data.loadAssets();
    if (lastUploaded) {
      data.setSelectedPath(lastUploaded.path);
      const detail = await window.standmeet.asset.get(lastUploaded.path);
      data.setSelectedAsset(detail);
    }
  }, [data]);

  return { isDragging, handleDragOver, handleDragEnter, handleDragLeave, handleDrop };
}

export default function AssetsPage() {
  const explorer = useResizable({ defaultWidth: 260, minWidth: 160, maxWidth: 480 });
  const data = useAssetData();
  const drop = useFileDrop(data);
  const [mode, setMode] = useState<Mode>({ type: "idle" });
  const [inputValue, setInputValue] = useState("");
  const namingInputRef = useRef<HTMLInputElement>(null);

  const handleNewFolder = useCallback(() => {
    setInputValue("");
    if (data.selectedPath) {
      const isFile = data.assets.some((a) => a.path === data.selectedPath);
      if (isFile) {
        const lastSlash = data.selectedPath.lastIndexOf("/");
        const parent = lastSlash > 0 ? data.selectedPath.substring(0, lastSlash + 1) : "/";
        setMode({ type: "naming", prefix: parent });
      } else {
        setMode({ type: "naming", prefix: data.selectedPath + "/" });
      }
    } else {
      setMode({ type: "naming", prefix: "/" });
    }
  }, [data.selectedPath, data.assets]);

  const handleCreateAt = useCallback((prefix: string) => {
    setInputValue("");
    setMode({ type: "naming", prefix });
  }, []);

  const handleNamingKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const name = inputValue.trim();
      if (!name || mode.type !== "naming") return;
      const prefix = mode.prefix === "/" ? "/" : mode.prefix;
      const folderPath = prefix + name.replace(/^\/+/, "");
      data.setSelectedPath(folderPath);
      data.setSelectedAsset(null);
      setMode({ type: "idle" });
      setInputValue("");
    } else if (e.key === "Escape") {
      setMode({ type: "idle" });
      setInputValue("");
    }
  }, [inputValue, mode, data]);

  const treeItems: ContentListItem[] = data.assets.map((a) => ({
    id: a.id,
    path: a.path,
    summary: a.filename,
    content_type: a.mime_type,
    visibility: a.visibility,
    updated_at: a.updated_at,
  }));

  return (
    <div className="page content-page" data-testid="assets-page">
      <AssetSidebar
        width={explorer.width}
        loading={data.loading}
        treeItems={treeItems}
        selectedPath={data.selectedPath}
        mode={mode}
        inputValue={inputValue}
        namingInputRef={namingInputRef}
        onSelect={data.handleSelect}
        onCreateAt={handleCreateAt}
        onNewFolder={handleNewFolder}
        onInputChange={setInputValue}
        onNamingKeyDown={handleNamingKeyDown}
        onNamingBlur={() => { setMode({ type: "idle" }); setInputValue(""); }}
      />
      <ResizeHandle onMouseDown={explorer.onMouseDown} />
      <div
        className={`content-editor-pane${drop.isDragging ? " drag-over" : ""}`}
        onDragOver={drop.handleDragOver}
        onDragEnter={drop.handleDragEnter}
        onDragLeave={drop.handleDragLeave}
        onDrop={drop.handleDrop}
      >
        {data.error && <div className="alert error" data-testid="asset-error">{data.error}</div>}
        {data.selectedAsset ? (
          <AssetDetail
            asset={data.selectedAsset}
            onVisibilityChange={data.handleVisibilityChange}
            onDelete={data.handleDelete}
          />
        ) : (
          <div className="editor-empty" data-testid="assets-empty-state">
            <p>
              {data.assets.length === 0
                ? "No assets uploaded yet"
                : "Select an asset to view details"}
            </p>
            <p className="hint">
              {drop.isDragging
                ? "Drop files here to upload"
                : <>Click <strong>+</strong> or drag files here to upload</>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AssetSidebar({
  width, loading, treeItems, selectedPath, mode,
  inputValue, namingInputRef,
  onSelect, onCreateAt, onNewFolder, onInputChange,
  onNamingKeyDown, onNamingBlur,
}: {
  width: number; loading: boolean;
  treeItems: ContentListItem[]; selectedPath: string | null;
  mode: Mode; inputValue: string;
  namingInputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (path: string) => void;
  onCreateAt: (prefix: string) => void;
  onNewFolder: () => void;
  onInputChange: (val: string) => void;
  onNamingKeyDown: (e: React.KeyboardEvent) => void;
  onNamingBlur: () => void;
}) {
  return (
    <div className="content-sidebar" style={{ width }}>
      <div className="content-sidebar-header">
        <span className="content-sidebar-title">ASSETS</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            data-testid="asset-export-all-btn"
            className="tree-action-btn"
            title="Export All"
            onClick={() => window.standmeet.data.exportCategoryToFile("assets")}
          >
            <Download size={14} />
          </button>
          <button
            data-testid="asset-upload-btn"
            className="tree-action-btn"
            title="New folder"
            onClick={onNewFolder}
          >
            +
          </button>
        </div>
      </div>
      {loading ? (
        <p className="muted tree-empty">Loading...</p>
      ) : (
        <FileTree
          items={treeItems}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onCreateAt={onCreateAt}
          naming={mode.type === "naming" ? {
            prefix: mode.prefix,
            value: inputValue,
            onChange: onInputChange,
            onKeyDown: onNamingKeyDown,
            onBlur: onNamingBlur,
            inputRef: namingInputRef,
            placeholder: "folder name",
          } : null}
        />
      )}
    </div>
  );
}
