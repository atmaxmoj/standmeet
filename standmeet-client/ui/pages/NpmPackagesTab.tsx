import { useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function NpmResultItem({ pkg, isInstalled, isInstalling, onInstall }: {
  pkg: NpmPackageInfo; isInstalled: boolean; isInstalling: boolean; onInstall: () => void;
}) {
  const label = isInstalled ? "Installed" : isInstalling ? "Installing..." : "+ Install";
  return (
    <div className="npm-result-item" data-testid="npm-result-item">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <strong>{pkg.name}</strong>
          <span className="muted" style={{ fontSize: "12px" }}>{pkg.version}</span>
        </div>
        {pkg.description && (
          <div className="muted" style={{ fontSize: "13px", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pkg.description}
          </div>
        )}
      </div>
      <button
        data-testid={`npm-add-${pkg.name}`}
        className={`small npm-result-add-btn ${isInstalled || isInstalling ? "" : "primary"}`}
        disabled={isInstalled || isInstalling}
        onClick={onInstall}
      >
        {label}
      </button>
    </div>
  );
}

function InstalledPackageCard({ pkg, onUninstall }: {
  pkg: GlobalPackage; onUninstall: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [readme, setReadme] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [homepage, setHomepage] = useState("");
  const [loading, setLoading] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    setLoading(true);
    window.standmeet.npm.readme(pkg.name)
      .then((info) => {
        if (info) {
          setReadme(info.readme);
          setDescription(info.description);
          setHomepage(info.homepage);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pkg.name]);

  return (
    <div className="npm-installed-card" data-testid="npm-installed-card">
      <div className="npm-installed-card-header">
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", marginRight: 2 }}>{expanded ? "▼" : "▶"}</span>
            <strong>{pkg.name}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{pkg.version}</span>
          </div>
          {!expanded && description && (
            <div className="muted" style={{ fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {description}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {homepage && (
            <a href={homepage} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12 }}
              onClick={(e) => e.stopPropagation()}>
              Homepage
            </a>
          )}
          <button className="small" onClick={onUninstall}>Uninstall</button>
        </div>
      </div>
      {expanded && (
        <div className="npm-installed-card-readme">
          {loading && <p className="muted">Loading...</p>}
          {!loading && readme ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
          ) : !loading ? (
            <p className="muted">No README available</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function NpmPackagesTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NpmPackageInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [globalPackages, setGlobalPackages] = useState<GlobalPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const loadGlobalPackages = useCallback(async () => {
    try {
      setLoadingPackages(true);
      setGlobalPackages(await window.standmeet.package.list());
    } catch {
      // ignore
    } finally {
      setLoadingPackages(false);
    }
  }, []);

  useEffect(() => { loadGlobalPackages(); }, [loadGlobalPackages]);

  const installedNames = new Set(globalPackages.map((p) => p.name));

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    try {
      setSearching(true); setError("");
      setResults(await window.standmeet.npm.search(q.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally { setSearching(false); }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleInstall = async (pkgName: string) => {
    if (installedNames.has(pkgName)) return;
    try {
      setInstalling(pkgName);
      setError("");
      await window.standmeet.package.install(pkgName);
      await loadGlobalPackages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (pkgName: string) => {
    try {
      setError("");
      await window.standmeet.package.uninstall(pkgName);
      await loadGlobalPackages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uninstall failed");
    }
  };

  return (
    <div data-testid="npm-packages-tab" className="iam-page" style={{ flex: 1 }}>
      <div className="iam-detail">
        <div className="iam-edit-panel">
          <h3 style={{ marginTop: 0 }}>Global npm Packages</h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            Packages installed here are available to all page builds.
          </p>
          <input
            data-testid="npm-search-input" type="text" value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search npm packages..."
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px" }}
          />
          {error && <div className="alert error" style={{ marginTop: 12 }}>{error}</div>}
          {searching && <p className="muted">Searching...</p>}
          {!searching && results.length === 0 && query.trim() && <p className="muted">No results found</p>}
          {!searching && results.length === 0 && !query.trim() && (
            <p className="muted" style={{ marginTop: 8 }}>Type to search npm packages</p>
          )}
          <div className="npm-result-list">
            {results.map((pkg) => (
              <NpmResultItem key={pkg.name} pkg={pkg}
                isInstalled={installedNames.has(pkg.name)}
                isInstalling={installing === pkg.name}
                onInstall={() => handleInstall(pkg.name)} />
            ))}
          </div>

          <h3>Installed Packages{loadingPackages ? " ..." : ` (${globalPackages.length})`}</h3>
          {globalPackages.length === 0 && !loadingPackages && (
            <p className="muted">No packages installed yet</p>
          )}
          <div className="npm-installed-list">
            {globalPackages.map((pkg) => (
              <InstalledPackageCard key={pkg.name} pkg={pkg}
                onUninstall={() => handleUninstall(pkg.name)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
