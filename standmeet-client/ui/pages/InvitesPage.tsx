import { useState, useEffect } from "react";
import { Download, Upload } from "lucide-react";
import ResizeHandle from "../components/ResizeHandle";
import { useResizable } from "../hooks/useResizable";
import InviteDetail from "../components/InviteDetail";
import ChatTestPanel from "../components/ChatTestPanel";
import CreateInviteForm from "../components/CreateInviteForm";

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

interface Props {
  onNavigateToContent?: (path: string) => void;
  onNavigateToSetup?: () => void;
}

type Selection =
  | { type: "invite"; code: string }
  | { type: "public-test" }
  | { type: "create" }
  | null;

function useInviteData() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [ownerToken, setOwnerToken] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [imConfig, setImConfig] = useState<{ telegram?: { botUsername: string }; discord?: { applicationId: string }; slack?: boolean }>({});
  const [selection, setSelection] = useState<Selection>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [inviteData, roleData, mcpServerData, skillData, pageData, config, settingsData] = await Promise.all([
        window.standmeet.invite.list(),
        window.standmeet.role.list(),
        window.standmeet.mcpServer.list(),
        window.standmeet.skill.list(),
        window.standmeet.page.list().catch(() => [] as PageListItem[]),
        window.standmeet.config.load(),
        window.standmeet.settings.get().catch(() => null),
      ]);
      setInvites(inviteData);
      setRoles(roleData);
      setMcpServers(mcpServerData);
      setSkills(skillData);
      setPages(pageData);
      if (config) {
        setGatewayUrl(config.server.gateway_url || deriveGatewayUrl(config.server.url));
        setOwnerToken(config.server.token);
        setWebUrl(config.server.web_url || deriveWebUrl(config.server.url));
      }
      if (settingsData?.im_integrations) {
        const im = settingsData.im_integrations;
        const cfg: typeof imConfig = {};
        if (im.telegram?.enabled && im.telegram.bot_username) {
          cfg.telegram = { botUsername: im.telegram.bot_username };
        }
        if (im.discord?.enabled && im.discord.application_id) cfg.discord = { applicationId: im.discord.application_id };
        if (im.slack?.enabled) cfg.slack = true;
        setImConfig(cfg);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleInviteCreated = async () => {
    await loadData();
    const updated = await window.standmeet.invite.list();
    if (updated.length > 0) setSelection({ type: "invite", code: updated[0].code });
  };

  const handleRevoke = async (code: string) => {
    try {
      await window.standmeet.invite.revoke(code);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to revoke invite");
    }
  };

  const handleUpdate = async (code: string, data: { role_id?: string | null; prompt?: string; max_messages_per_session?: number | null; mcp_server_ids?: string[]; skill_ids?: string[] }) => {
    try {
      await window.standmeet.invite.update(code, data);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update invite");
    }
  };

  const handleDelete = async (code: string) => {
    try {
      await window.standmeet.invite.delete(code);
      setSelection(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete invite");
    }
  };

  return {
    invites, roles, mcpServers, skills, pages,
    loading, error, setError, gatewayUrl, ownerToken, webUrl, imConfig,
    selection, setSelection, loadData,
    handleInviteCreated, handleRevoke, handleUpdate, handleDelete,
  };
}

function InviteSidebar({
  state, width,
}: {
  state: ReturnType<typeof useInviteData>;
  width: number;
}) {
  return (
    <div className="invite-list-sidebar" style={{ width }}>
      <div className="invite-list-header">
        <span className="invite-list-title">INVITES</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="tree-action-btn" title="Import"
            onClick={async () => { await window.standmeet.data.importCategoryFromFile("invites"); state.loadData(); }}>
            <Upload size={14} />
          </button>
          <button data-testid="invite-export-all-btn" className="tree-action-btn" title="Export All"
            onClick={() => window.standmeet.data.exportCategoryToFile("invites")}>
            <Download size={14} />
          </button>
          <button data-testid="invite-new-btn" className="tree-action-btn" title="Create invite"
            onClick={() => state.setSelection({ type: "create" })}>
            +
          </button>
        </div>
      </div>
      {state.error && <div className="alert error" style={{ margin: "8px 12px", fontSize: 13 }}>{state.error}</div>}
      {state.loading ? (
        <p className="muted tree-empty">Loading...</p>
      ) : (
        <ul className="invite-list">
          <li>
            <button
              className={`invite-list-item ${state.selection?.type === "public-test" ? "active" : ""}`}
              onClick={() => state.setSelection({ type: "public-test" })}
            >
              <span className="invite-list-label">Public View</span>
              <span className="invite-list-badge">Test</span>
            </button>
          </li>
          {state.invites.map((invite) => (
            <li key={invite.id}>
              <button
                data-testid={`invite-item-${invite.code}`}
                className={`invite-list-item ${state.selection?.type === "invite" && state.selection.code === invite.code ? "active" : ""} ${!invite.is_active ? "inactive" : ""}`}
                onClick={() => state.setSelection({ type: "invite", code: invite.code })}
              >
                <div className="invite-list-item-main">
                  <span className="invite-list-label">{invite.label}</span>
                  <span className={`status-badge ${invite.is_active ? "connected" : "disconnected"}`}>
                    {invite.is_active ? "Active" : "Revoked"}
                  </span>
                </div>
                <span className="invite-list-code">{invite.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InviteDetailPane({
  state, onNavigateToContent, onNavigateToSetup,
}: {
  state: ReturnType<typeof useInviteData>;
  onNavigateToContent?: (path: string) => void;
  onNavigateToSetup?: () => void;
}) {
  const selectedInvite = state.selection?.type === "invite"
    ? state.invites.find((inv) => inv.code === (state.selection as { type: "invite"; code: string }).code) ?? null
    : null;

  const publicAuthPayload = { owner_token: state.ownerToken, preview_mode: "public" };

  if (state.selection?.type === "create") {
    return (
      <CreateInviteForm
        roles={state.roles}
        onCreated={state.handleInviteCreated}
        onCancel={() => state.setSelection(null)}
        onError={state.setError}
      />
    );
  }

  if (state.selection?.type === "public-test") {
    return (
      <div className="invite-detail">
        <div className="invite-detail-section">
          <h3>Test Public View</h3>
          <p className="hint" style={{ marginTop: 4 }}>
            Preview how a visitor sees your public content through MCP.
          </p>
        </div>
        <div className="invite-detail-section">
          <div className="invite-detail-section-header">
            <span className="invite-detail-section-title">Chat Test</span>
          </div>
          {!state.gatewayUrl ? (
            <div className="invite-detail-gateway-notice">
              <p>Gateway URL not configured.</p>
              {onNavigateToSetup && (
                <button className="small primary" onClick={onNavigateToSetup}>Go to Server Setup</button>
              )}
            </div>
          ) : (
            <ChatTestPanel
              key="public-test"
              gatewayUrl={state.gatewayUrl}
              authPayload={publicAuthPayload}
              onNavigateToContent={onNavigateToContent}
            />
          )}
        </div>
      </div>
    );
  }

  if (selectedInvite) {
    return (
      <InviteDetail
        key={selectedInvite.code}
        invite={selectedInvite}
        roles={state.roles}
        mcpServers={state.mcpServers}
        skills={state.skills}
        pages={state.pages}
        gatewayUrl={state.gatewayUrl}
        ownerToken={state.ownerToken}
        webUrl={state.webUrl}
        imConfig={state.imConfig}
        onUpdate={state.handleUpdate}
        onRevoke={state.handleRevoke}
        onDelete={state.handleDelete}
        onNavigateToContent={onNavigateToContent}
        onNavigateToSetup={onNavigateToSetup}
      />
    );
  }

  return (
    <div className="invite-detail-empty">
      <p>Select an invite to view details</p>
      <p className="hint">or click <strong>+</strong> to create a new one</p>
    </div>
  );
}

export default function InvitesPage({ onNavigateToContent, onNavigateToSetup }: Props) {
  const sidebar = useResizable({ defaultWidth: 280, minWidth: 200, maxWidth: 420 });
  const state = useInviteData();

  return (
    <div className="page invites-page">
      <InviteSidebar state={state} width={sidebar.width} />
      <ResizeHandle onMouseDown={sidebar.onMouseDown} />
      <div className="invite-detail-pane">
        <InviteDetailPane
          state={state}
          onNavigateToContent={onNavigateToContent}
          onNavigateToSetup={onNavigateToSetup}
        />
      </div>
    </div>
  );
}
