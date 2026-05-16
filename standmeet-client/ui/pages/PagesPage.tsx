import { useState, useEffect, useCallback } from "react";
import MyPagesTab from "./MyPagesTab";
import NpmPackagesTab from "./NpmPackagesTab";

/** Derive gateway WebSocket URL from server HTTP URL (port 8000 -> 8001). */
function deriveGatewayUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    const port = u.port ? String(Number(u.port) + 1) : "8001";
    return `${proto}//${u.hostname}:${port}`;
  } catch {
    return "";
  }
}

/** Derive web frontend URL from server HTTP URL (port 8000 -> 3000). */
function deriveWebUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    return `${u.protocol}//${u.hostname}:3000`;
  } catch {
    return "";
  }
}

type Mode =
  | { type: "idle" }
  | { type: "view"; page: Page }
  | { type: "new" };

export interface PageListState {
  pages: PageListItem[];
  mode: Mode;
  setMode: (m: Mode) => void;
  loading: boolean;
  loadPages: () => Promise<void>;
  handleSelect: (id: string) => void;
  handleNew: () => void;
  selectedPageId: string | null;
  selectedPageName: string | undefined;
  mustUse: string[];
  dontUse: string[];
  onMustUseChange: (pkgs: string[]) => void;
  onDontUseChange: (pkgs: string[]) => void;
  onSelectionChange: (id: string | null, name: string | undefined) => void;
  gatewayUrl: string;
  ownerToken: string;
  webUrl: string;
  roles: Role[];
}

function usePageList() {
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [mode, setMode] = useState<Mode>({ type: "idle" });
  const [loading, setLoading] = useState(true);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedPageName, setSelectedPageName] = useState<string | undefined>();
  const [mustUse, setMustUse] = useState<string[]>([]);
  const [dontUse, setDontUse] = useState<string[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [ownerToken, setOwnerToken] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);

  const loadPages = useCallback(async () => {
    try {
      setLoading(true);
      setPages(await window.standmeet.page.list());
    } catch {
      // handled by consumers
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
    (async () => {
      try { setRoles(await window.standmeet.role.list()); } catch { /* ignore */ }
    })();
    window.standmeet.config.load().then((config) => {
      if (config) {
        setGatewayUrl(config.server.gateway_url || deriveGatewayUrl(config.server.url));
        setOwnerToken(config.server.token);
        setWebUrl(config.server.web_url || deriveWebUrl(config.server.url));
      }
    }).catch(() => {});
  }, [loadPages]);

  const handleSelect = async (id: string) => {
    try {
      const page = await window.standmeet.page.get(id);
      setMode({ type: "view", page });
      setSelectedPageId(page.id);
      setSelectedPageName(page.name);
      setMustUse(page.must_use || []);
      setDontUse(page.dont_use || []);
    } catch {
      // ignore
    }
  };

  const handleNew = () => {
    setMode({ type: "new" });
    setSelectedPageId(null);
    setSelectedPageName(undefined);
    setMustUse([]);
    setDontUse([]);
  };

  const onSelectionChange = useCallback((id: string | null, name: string | undefined) => {
    setSelectedPageId(id);
    setSelectedPageName(name);
  }, []);

  return {
    pages, mode, setMode, loading, loadPages,
    handleSelect, handleNew,
    selectedPageId, selectedPageName,
    mustUse, dontUse,
    onMustUseChange: setMustUse, onDontUseChange: setDontUse,
    onSelectionChange,
    gatewayUrl, ownerToken, webUrl, roles,
  };
}

export function PageSidebar({ pages, mode, loading, width, onSelect, onNew }: {
  pages: PageListItem[]; mode: Mode; loading: boolean; width: number;
  onSelect: (id: string) => void; onNew: () => void;
}) {
  const statusBadge = (status: string) => {
    const cls = status === "ready" ? "connected" : status === "failed" ? "disconnected" : "";
    return <span className={`status-badge ${cls}`}>{status}</span>;
  };

  return (
    <div className="content-sidebar" style={{ width }}>
      <div className="content-sidebar-header">
        <span className="content-sidebar-title">PAGES</span>
        <button data-testid="page-new-btn" className="small" onClick={onNew}>+</button>
      </div>
      {loading ? (
        <p className="muted tree-empty">Loading...</p>
      ) : pages.length === 0 ? (
        <p className="muted tree-empty">No pages yet</p>
      ) : (
        <ul className="sidebar-list">
          {pages.map((p) => (
            <li key={p.id}>
              <button
                className={`sidebar-item ${mode.type === "view" && mode.page.id === p.id ? "active" : ""}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="sidebar-item-name">{p.name}</span>
                {statusBadge(p.status)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PagesPage() {
  const [activeTab, setActiveTab] = useState<"pages" | "npm">("pages");
  const state = usePageList();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border, #ddd)", padding: "0 16px" }}>
        <button
          data-testid="pages-tab-my"
          className={`small ${activeTab === "pages" ? "primary" : ""}`}
          onClick={() => setActiveTab("pages")}
          style={{ borderRadius: "4px 4px 0 0", borderBottom: activeTab === "pages" ? "2px solid var(--accent, #2196f3)" : "2px solid transparent" }}
        >
          My Pages
        </button>
        <button
          data-testid="pages-tab-npm"
          className={`small ${activeTab === "npm" ? "primary" : ""}`}
          onClick={() => setActiveTab("npm")}
          style={{ borderRadius: "4px 4px 0 0", borderBottom: activeTab === "npm" ? "2px solid var(--accent, #2196f3)" : "2px solid transparent" }}
        >
          npm Packages
        </button>
      </div>
      {activeTab === "pages"
        ? <MyPagesTab state={state} />
        : <NpmPackagesTab />
      }
    </div>
  );
}
