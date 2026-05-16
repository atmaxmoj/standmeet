import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ResizeHandle from "./components/ResizeHandle";
import { useResizable } from "./hooks/useResizable";
import SetupPage from "./pages/SetupPage";
import ContentPage from "./pages/ContentPage";
import InvitesPage from "./pages/InvitesPage";
import IAMPage from "./pages/IAMPage";
import McpPage from "./pages/McpPage";
import SkillsPage from "./pages/SkillsPage";
import AssetsPage from "./pages/AssetsPage";
import PagesPage from "./pages/PagesPage";
import SettingsPage from "./pages/SettingsPage";

export type Page = "setup" | "content" | "assets" | "invites" | "iam" | "mcp" | "pages" | "skills" | "settings";

export default function App() {
  const sidebar = useResizable({ defaultWidth: 220, minWidth: 160, maxWidth: 360 });
  const [page, setPage] = useState<Page>("setup");
  const [configured, setConfigured] = useState(false);
  const [online, setOnline] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [storageUsedBytes, setStorageUsedBytes] = useState<number | undefined>();
  const [storageTotalBytes, setStorageTotalBytes] = useState<number | undefined>();
  const [contentPath, setContentPath] = useState<string | null>(null);

  useEffect(() => {
    window.standmeet.config.isConfigured().then((ok) => {
      setConfigured(ok);
    });
  }, []);

  // Poll server status when configured
  useEffect(() => {
    if (!configured) {
      setOnline(false);
      return;
    }

    const check = () => {
      window.standmeet.status
        .get()
        .then((s) => {
          setOnline(true);
          if (s.version) setVersion(s.version);
          if (s.storage_used_bytes != null) setStorageUsedBytes(s.storage_used_bytes);
          if (s.storage_total_bytes != null) setStorageTotalBytes(s.storage_total_bytes);
        })
        .catch(() => setOnline(false));
    };

    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [configured]);

  const handleConfigured = (v?: string) => {
    setConfigured(true);
    setOnline(true);
    if (v) setVersion(v);
    setPage("content");
  };

  const handleNavigateToContent = (path: string) => {
    setContentPath(path);
    setPage("content");
  };

  return (
    <>
      <div style={{ width: sidebar.width, flexShrink: 0, display: "flex" }}>
        <Sidebar
          activePage={page}
          onNavigate={(p) => {
            setPage(p);
            if (p !== "content") setContentPath(null);
          }}
          configured={configured}
          online={online}
          version={version}
          storageUsedBytes={storageUsedBytes}
          storageTotalBytes={storageTotalBytes}
        />
        <ResizeHandle onMouseDown={sidebar.onMouseDown} />
      </div>
      <main className="main-content">
        {page === "setup" && <SetupPage onConfigured={handleConfigured} />}
        {page !== "setup" && !online ? (
          <div className="offline-notice">
            <h3>Server not connected</h3>
            <p>Go to <button className="link-btn" onClick={() => setPage("setup")}>Setup</button> to configure your server connection.</p>
          </div>
        ) : (
          <>
            {page === "content" && <ContentPage initialPath={contentPath} />}
            {page === "assets" && <AssetsPage />}
            {page === "invites" && <InvitesPage onNavigateToContent={handleNavigateToContent} onNavigateToSetup={() => setPage("setup")} />}
            {page === "iam" && <IAMPage />}
            {page === "mcp" && <McpPage />}
            {page === "pages" && <PagesPage />}
            {page === "skills" && <SkillsPage />}
            {page === "settings" && <SettingsPage />}
          </>
        )}
      </main>
    </>
  );
}
