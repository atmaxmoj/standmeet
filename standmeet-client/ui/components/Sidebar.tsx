import type { Page } from "../App";

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  configured: boolean;
  online: boolean;
  version: string | null;
  storageUsedBytes?: number;
  storageTotalBytes?: number;
}

const NAV_ITEMS: { page: Page; label: string }[] = [
  { page: "setup", label: "Setup" },
  { page: "content", label: "Content" },
  { page: "assets", label: "Assets" },
  { page: "invites", label: "Invites" },
  { page: "iam", label: "IAM" },
  { page: "mcp", label: "MCP" },
  { page: "pages", label: "Pages" },
  { page: "skills", label: "Skills" },
  { page: "settings", label: "Settings" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export default function Sidebar({
  activePage,
  onNavigate,
  configured,
  online,
  version,
  storageUsedBytes,
  storageTotalBytes,
}: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h1>StandMeet</h1>
      </div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map(({ page, label }) => (
          <li key={page}>
            <button
              data-testid={`nav-${page}`}
              className={`sidebar-item ${activePage === page ? "active" : ""}`}
              onClick={() => onNavigate(page)}
              disabled={page !== "setup" && !configured}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">
        {configured && online && storageUsedBytes != null && storageTotalBytes != null && storageTotalBytes > 0 && (
          <span
            data-testid="storage-usage"
            className={`sidebar-storage ${
              storageUsedBytes / storageTotalBytes > 0.95
                ? "danger"
                : storageUsedBytes / storageTotalBytes > 0.8
                  ? "warning"
                  : ""
            }`}
          >
            Storage: {formatBytes(storageUsedBytes)} / {formatBytes(storageTotalBytes)}
          </span>
        )}
        {!configured ? (
          <span data-testid="status-badge" className="status-badge disconnected">Not configured</span>
        ) : online ? (
          <span data-testid="status-badge" className="status-badge connected">
            Connected{version ? ` · v${version}` : ""}
          </span>
        ) : (
          <span data-testid="status-badge" className="status-badge disconnected">Offline</span>
        )}
      </div>
    </nav>
  );
}
