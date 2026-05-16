import { useState, useEffect } from "react";

interface Props {
  onConfigured: (version?: string) => void;
}

interface McpState {
  status: "idle" | "configured" | "error";
  path?: string;
  stale?: boolean;
}

function useSetupForm(onConfigured: (version?: string) => void) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    window.standmeet.config.load().then((config) => {
      if (config) {
        setUrl(config.server.url);
        setToken(config.server.token);
      }
    });
  }, []);

  const handleSave = async () => {
    try {
      await window.standmeet.config.save({ server: { url, token } });
      setStatus({ type: "success", message: "Configuration saved" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus({ type: "error", message });
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      await window.standmeet.config.save({ server: { url, token } });
      const result = await window.standmeet.status.get();
      setStatus({
        type: "success",
        message: `Configured! Server v${result.version} — ${result.content_count} content entries, ${result.active_invites} active invites`,
      });
      onConfigured(result.version);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus({ type: "error", message: `Connection failed: ${message}` });
    } finally {
      setTesting(false);
    }
  };

  return { url, setUrl, token, setToken, testing, status, setStatus, handleSave, handleTest };
}

function useMcpIntegrations() {
  const [mcpClaudeCode, setMcpClaudeCode] = useState<McpState>({ status: "idle" });
  const [mcpClaudeDesktop, setMcpClaudeDesktop] = useState<McpState>({ status: "idle" });

  useEffect(() => {
    window.standmeet.mcp.checkClaudeCode().then((result) => {
      if (result) setMcpClaudeCode({ status: "configured", path: result.path, stale: result.stale });
    });
    window.standmeet.mcp.checkClaudeDesktop().then((result) => {
      if (result) setMcpClaudeDesktop({ status: "configured", path: result.path, stale: result.stale });
    });
  }, []);

  return { mcpClaudeCode, setMcpClaudeCode, mcpClaudeDesktop, setMcpClaudeDesktop };
}

function McpCard({
  label, state, onConnect,
}: {
  label: string;
  state: McpState;
  onConnect: () => void;
}) {
  const descriptionIdle: Record<string, string> = {
    "Claude Code": "Use StandMeet tools in Claude Code across all your projects.",
    "Claude Desktop": "Use StandMeet tools in the Claude Desktop app.",
  };

  return (
    <div className={`mcp-card ${state.status === "configured" ? (state.stale ? "stale" : "configured") : ""}`}>
      <div className="mcp-card-header">
        <strong>{label}</strong>
        {state.status === "configured" && (
          state.stale
            ? <span className="mcp-badge stale">Needs reconfigure</span>
            : <span className="mcp-badge">Configured</span>
        )}
      </div>
      <p className="mcp-card-desc">
        {state.status === "configured"
          ? state.path ?? "Configured"
          : descriptionIdle[label] ?? ""}
      </p>
      <button className={state.stale ? "primary" : undefined} onClick={onConnect}>
        {state.status === "configured" ? "Reconfigure" : "Configure"}
      </button>
    </div>
  );
}

export default function SetupPage({ onConfigured }: Props) {
  const form = useSetupForm(onConfigured);
  const mcp = useMcpIntegrations();

  const connectClaudeCode = async () => {
    try {
      const configPath = await window.standmeet.mcp.connectClaudeCode();
      mcp.setMcpClaudeCode({ status: "configured", path: configPath, stale: false });
      form.setStatus({ type: "success", message: "Claude Code configured. Available in all projects." });
    } catch (err: unknown) {
      mcp.setMcpClaudeCode({ status: "error" });
      const message = err instanceof Error ? err.message : "Unknown error";
      form.setStatus({ type: "error", message: `Failed: ${message}` });
    }
  };

  const connectClaudeDesktop = async () => {
    try {
      const configPath = await window.standmeet.mcp.connectClaudeDesktop();
      mcp.setMcpClaudeDesktop({ status: "configured", path: configPath, stale: false });
      form.setStatus({ type: "success", message: "Claude Desktop configured. Restart Claude Desktop to apply." });
    } catch (err: unknown) {
      mcp.setMcpClaudeDesktop({ status: "error" });
      const message = err instanceof Error ? err.message : "Unknown error";
      form.setStatus({ type: "error", message: `Failed: ${message}` });
    }
  };

  return (
    <div className="page">
      <h2>Server Setup</h2>
      <p className="page-desc">Configure your StandMeet server connection.</p>
      <div className="form-group">
        <label htmlFor="url">Server URL</label>
        <input id="url" data-testid="setup-url" type="url"
          placeholder="https://your-server.example.com"
          value={form.url} onChange={(e) => form.setUrl(e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="token">Owner Token</label>
        <input id="token" data-testid="setup-token" type="password"
          placeholder="smo_..." value={form.token}
          onChange={(e) => form.setToken(e.target.value)} />
      </div>
      <div className="button-row">
        <button onClick={form.handleSave} disabled={!form.url || !form.token}>Save</button>
        <button data-testid="setup-test-btn" className="primary"
          onClick={form.handleTest} disabled={!form.url || !form.token || form.testing}>
          {form.testing ? "Testing..." : "Test Connection"}
        </button>
      </div>
      {form.status && (
        <div data-testid="setup-status" className={`alert ${form.status.type}`}>{form.status.message}</div>
      )}

      <hr style={{ margin: "2rem 0", border: "none", borderTop: "1px solid var(--border)" }} />
      <h3>MCP Integrations</h3>
      <p className="page-desc">
        Connect your StandMeet MCP server to AI clients. This lets you manage content, invites, roles, and settings directly from your AI assistant.
      </p>
      <div className="mcp-cards">
        <McpCard label="Claude Code" state={mcp.mcpClaudeCode} onConnect={connectClaudeCode} />
        <McpCard label="Claude Desktop" state={mcp.mcpClaudeDesktop} onConnect={connectClaudeDesktop} />
      </div>
    </div>
  );
}
