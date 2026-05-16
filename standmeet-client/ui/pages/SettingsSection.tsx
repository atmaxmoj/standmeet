import { useState } from "react";
import type {
  ImIntegrations,
  ImIntegrationConfig,
  ExportManifest,
  ImportSelection,
  ImportResult,
  CategoryResult,
} from "../../src/types";

const IM_PLATFORMS = [
  {
    key: "telegram" as const, label: "Telegram",
    guide: "Create a bot via @BotFather on Telegram and copy the token.",
    fields: [{ name: "bot_token", label: "Bot Token", placeholder: "123456:ABC-DEF..." }],
  },
  {
    key: "discord" as const, label: "Discord",
    guide: "Create an app at discord.com/developers, add a Bot, and copy the token and Application ID.",
    fields: [
      { name: "bot_token", label: "Bot Token", placeholder: "MTIz..." },
      { name: "application_id", label: "Application ID", placeholder: "123456789012345678" },
    ],
  },
  {
    key: "slack" as const, label: "Slack",
    guide: "Create an app at api.slack.com/apps with Socket Mode enabled. Copy the Bot Token (xoxb-) and App Token (xapp-).",
    fields: [
      { name: "bot_token", label: "Bot Token", placeholder: "xoxb-..." },
      { name: "app_token", label: "App Token", placeholder: "xapp-..." },
    ],
  },
];

export function ImIntegrationsSection({
  integrations, onChange,
}: {
  integrations: ImIntegrations;
  onChange: (im: ImIntegrations) => void;
}) {
  const update = (platform: keyof ImIntegrations, patch: Partial<ImIntegrationConfig>) => {
    const current = integrations[platform] ?? { enabled: false };
    onChange({ ...integrations, [platform]: { ...current, ...patch } });
  };

  return (
    <section className="settings-section">
      <h3>IM Integrations</h3>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        Allow visitors to chat via messaging platforms using invite codes.
      </p>
      {IM_PLATFORMS.map(({ key, label, guide, fields }) => {
        const config = integrations[key] ?? { enabled: false };
        return (
          <div key={key} data-testid={`im-card-${key}`} className="im-card" style={{ marginBottom: 16, padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 8 }}>
            <div className="toggle-row" style={{ marginBottom: config.enabled ? 8 : 0 }}>
              <input type="checkbox" id={`toggle-im-${key}`} data-testid={`im-toggle-${key}`}
                checked={config.enabled ?? false} onChange={(e) => update(key, { enabled: e.target.checked })} />
              <label htmlFor={`toggle-im-${key}`}>{label}</label>
            </div>
            {config.enabled && (
              <p className="muted" data-testid={`im-guide-${key}`} style={{ margin: "4px 0 4px", fontSize: 12 }}>{guide}</p>
            )}
            {config.enabled && fields.map((field) => (
              <div key={field.name} className="form-group" style={{ marginTop: 8 }}>
                <label htmlFor={`im-${key}-${field.name}`}>{field.label}</label>
                <input id={`im-${key}-${field.name}`} data-testid={`im-${key}-${field.name}`} type="password"
                  value={(config as Record<string, unknown>)[field.name] as string ?? ""}
                  onChange={(e) => update(key, { [field.name]: e.target.value })}
                  placeholder={field.placeholder} style={{ fontFamily: "monospace" }} />
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

const IMPORT_CATEGORIES = [
  { key: "content" as const, label: "Content" },
  { key: "skills" as const, label: "Skills" },
  { key: "mcp_servers" as const, label: "MCP Servers" },
  { key: "roles" as const, label: "Roles" },
  { key: "invites" as const, label: "Invites" },
  { key: "settings" as const, label: "Settings" },
  { key: "assets" as const, label: "Assets" },
] as const;

function categoryCount(manifest: ExportManifest, key: keyof ImportSelection): number {
  if (key === "settings") return 1;
  const arr = manifest[key];
  return Array.isArray(arr) ? arr.length : 0;
}

function formatResult(r: CategoryResult): string {
  const parts: string[] = [];
  if (r.created > 0) parts.push(`${r.created} created`);
  if (r.updated > 0) parts.push(`${r.updated} updated`);
  if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
  if (r.failed > 0) parts.push(`${r.failed} failed`);
  return parts.length > 0 ? parts.join(", ") : "nothing to import";
}

export function DataSection() {
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ manifest: ExportManifest; hasAssets: boolean; zipPath: string } | null>(null);
  const [selected, setSelected] = useState<ImportSelection>({
    content: true, skills: true, mcp_servers: true,
    roles: true, invites: true, settings: true, assets: true,
  });
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const handleExport = async () => {
    setExporting(true); setError(""); setExportResult(null);
    try {
      const filePath = await window.standmeet.data.exportToFile();
      if (filePath) setExportResult(filePath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally { setExporting(false); }
  };

  const handleLoadImport = async () => {
    setError(""); setImportResult(null);
    try {
      const result = await window.standmeet.data.loadImportFile();
      if (result) {
        setPreview(result);
        setSelected({ content: true, skills: true, mcp_servers: true, roles: true, invites: true, settings: true, assets: true });
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to load file"); }
  };

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true); setError("");
    try {
      const result = await window.standmeet.data.executeImport(preview.zipPath, selected);
      setImportResult(result); setPreview(null);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { setImporting(false); }
  };

  return (
    <section className="settings-section" data-testid="data-section">
      <h3>Data</h3>
      <div className="data-actions">
        <button data-testid="data-export-btn" onClick={handleExport} disabled={exporting}>
          {exporting ? "Exporting..." : "Export"}
        </button>
        <button data-testid="data-import-btn" onClick={handleLoadImport} disabled={importing}>Import</button>
      </div>
      {exportResult && <div className="alert success" data-testid="data-export-result">Exported to {exportResult}</div>}
      {error && <div className="alert error" data-testid="data-error">{error}</div>}
      {preview && (
        <ImportPreview preview={preview} selected={selected} importing={importing}
          onToggle={(key) => setSelected((prev) => ({ ...prev, [key]: !prev[key] }))}
          onImport={handleImport} onCancel={() => setPreview(null)} />
      )}
      {importResult && <ImportResultView result={importResult} />}
    </section>
  );
}

function ImportPreview({ preview, selected, importing, onToggle, onImport, onCancel }: {
  preview: { manifest: ExportManifest }; selected: ImportSelection; importing: boolean;
  onToggle: (key: keyof ImportSelection) => void; onImport: () => void; onCancel: () => void;
}) {
  return (
    <div className="data-preview" data-testid="data-import-preview">
      <h4>Import Preview</h4>
      {IMPORT_CATEGORIES.map(({ key, label }) => {
        const count = categoryCount(preview.manifest, key);
        return (
          <div key={key} className="toggle-row" style={{ marginBottom: 4 }}>
            <input type="checkbox" id={`import-${key}`} data-testid={`import-check-${key}`}
              checked={selected[key]} onChange={() => onToggle(key)} disabled={count === 0} />
            <label htmlFor={`import-${key}`}>
              {label} ({count}{key === "settings" ? "" : count === 1 ? " entry" : " entries"})
            </label>
          </div>
        );
      })}
      <div className="data-actions" style={{ marginTop: 12 }}>
        <button className="primary" data-testid="data-import-confirm-btn" onClick={onImport} disabled={importing}>
          {importing ? "Importing..." : "Confirm Import"}
        </button>
        <button data-testid="data-import-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ImportResultView({ result }: { result: ImportResult }) {
  return (
    <div className="data-result" data-testid="data-import-result">
      <h4>Import Result</h4>
      {IMPORT_CATEGORIES.map(({ key, label }) => {
        const r = result[key];
        const hasFailure = r.failed > 0;
        return (
          <div key={key} data-testid={`import-result-${key}`} className="data-result-row">
            <span className={hasFailure ? "result-fail" : "result-ok"}>
              {hasFailure ? "\u2717" : "\u2713"}
            </span>
            {" "}{label}: {formatResult(r)}
          </div>
        );
      })}
    </div>
  );
}
