import { useState, useCallback } from "react";

interface AssetDetailProps {
  asset: Asset;
  onVisibilityChange: (visibility: "private" | "public") => void;
  onDelete: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function mimeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "🖼";
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.startsWith("text/")) return "📝";
  return "📎";
}

function AssetPreview({ asset }: { asset: Asset }) {
  const isImage = asset.mime_type.startsWith("image/");
  const isPdf = asset.mime_type === "application/pdf";

  if (isImage && asset.download_url) {
    return (
      <div className="asset-preview" data-testid="asset-preview">
        <img src={asset.download_url} alt={asset.filename} />
      </div>
    );
  }
  if (isPdf && asset.download_url) {
    return (
      <div className="asset-preview" data-testid="asset-preview">
        <iframe src={asset.download_url} title={asset.filename} />
      </div>
    );
  }
  return (
    <div className="asset-preview-placeholder">
      <span className="asset-preview-icon">{mimeIcon(asset.mime_type)}</span>
      <span className="asset-preview-type">{asset.mime_type}</span>
    </div>
  );
}

function AssetActions({
  asset, onVisibilityChange, onDelete,
}: {
  asset: Asset;
  onVisibilityChange: (visibility: "private" | "public") => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="asset-actions">
      <select
        className="asset-visibility-select"
        data-testid="asset-visibility-select"
        value={asset.visibility}
        onChange={(e) =>
          onVisibilityChange(e.target.value as "private" | "public")
        }
      >
        <option value="private">Private</option>
        <option value="public">Public</option>
      </select>

      {asset.download_url && (
        <a
          href={asset.download_url}
          target="_blank"
          rel="noopener noreferrer"
          className="asset-btn"
          data-testid="asset-download-btn"
        >
          Download
        </a>
      )}

      {!confirmDelete ? (
        <button
          className="asset-btn danger"
          data-testid="asset-delete-btn"
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </button>
      ) : (
        <>
          <button
            className="asset-btn danger"
            data-testid="asset-delete-confirm-btn"
            onClick={onDelete}
          >
            Confirm
          </button>
          <button
            className="asset-btn"
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

export default function AssetDetail({
  asset,
  onVisibilityChange,
  onDelete,
}: AssetDetailProps) {
  const [copied, setCopied] = useState(false);

  const copyUrl = useCallback(() => {
    if (!asset.download_url) return;
    navigator.clipboard.writeText(asset.download_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [asset.download_url]);

  return (
    <div className="asset-detail" data-testid="asset-detail">
      <AssetPreview asset={asset} />

      <div className="asset-info">
        <h3 data-testid="asset-detail-filename">{asset.filename}</h3>
        <span className="asset-path">{asset.path}</span>

        <div className="asset-meta">
          <span data-testid="asset-detail-size">{formatSize(asset.size)}</span>
          <span className="asset-meta-sep">·</span>
          <span data-testid="asset-detail-type">{asset.mime_type.split("/")[1]}</span>
          <span className="asset-meta-sep">·</span>
          <span title={new Date(asset.updated_at).toLocaleString()}>{formatDate(asset.updated_at)}</span>
        </div>

        {asset.visibility === "public" && asset.download_url && (
          <div className="asset-public-url">
            <div className="asset-public-url-header">
              <span className="asset-public-label">Public URL</span>
              <span className="asset-public-hint">Anyone with this link can access this file</span>
            </div>
            <div className="asset-public-url-row">
              <input
                className="asset-url-input"
                value={asset.download_url}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button className="asset-btn" onClick={copyUrl}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <AssetActions
          asset={asset}
          onVisibilityChange={onVisibilityChange}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
