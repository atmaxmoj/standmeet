import { useState, useEffect, useRef } from "react";
import ChatTestPanel from "./ChatTestPanel";
import ChatLogPanel from "./ChatLogPanel";
import { ShareButtons, InviteMeta } from "./InviteDetailForm";

interface ImConfig {
  telegram?: { botUsername: string };
  discord?: { applicationId: string };
  slack?: boolean;
}

interface Props {
  invite: InviteCode;
  roles: Role[];
  mcpServers: McpServer[];
  skills: Skill[];
  pages: PageListItem[];
  gatewayUrl: string;
  ownerToken: string;
  webUrl?: string;
  imConfig: ImConfig;
  onUpdate: (code: string, data: { label?: string; role_id?: string | null; page_id?: string | null; prompt?: string; greeting?: string; max_uses?: number | null; max_messages_per_session?: number | null; mcp_server_ids?: string[]; skill_ids?: string[] }) => void;
  onRevoke: (code: string) => void;
  onDelete: (code: string) => void;
  onNavigateToContent?: (path: string) => void;
  onNavigateToSetup?: () => void;
}

export default function InviteDetail({
  invite, roles, mcpServers, skills, pages, gatewayUrl, ownerToken, webUrl, imConfig,
  onUpdate, onRevoke, onDelete, onNavigateToContent, onNavigateToSetup,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copiedShare, setCopiedShare] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState(invite.prompt ?? "");
  const [promptDirty, setPromptDirty] = useState(false);
  const [greetingDraft, setGreetingDraft] = useState(invite.greeting ?? "");
  const [greetingDirty, setGreetingDirty] = useState(false);
  const [skillsDropdownOpen, setSkillsDropdownOpen] = useState(false);
  const skillsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (skillsDropdownRef.current && !skillsDropdownRef.current.contains(e.target as Node)) {
        setSkillsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const copyCode = () => {
    navigator.clipboard.writeText(invite.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasReportSkill = skills.some((s) => s.name === "Conversation Report");
  const authPayload = { owner_token: ownerToken, preview_mode: "invitation", invite_code: invite.code };

  return (
    <div className="invite-detail">
      <div className="invite-detail-section">
        <div className="invite-detail-header">
          <input className="invite-label-editable" value={invite.label}
            onChange={(e) => onUpdate(invite.code, { label: e.target.value })} />
          <span className={`status-badge ${invite.is_active ? "connected" : "disconnected"}`}>
            {invite.is_active ? "Active" : "Revoked"}
          </span>
        </div>
        <div className="invite-copy-rows">
          <div data-testid="invite-code" className="invite-copy-row" onClick={copyCode} title="Click to copy code">
            <span className="invite-copy-label">Code</span>
            <code>{invite.code}</code>
            <span className="invite-copy-action">{copied ? "Copied!" : "Copy"}</span>
          </div>
        </div>
        <ShareButtons code={invite.code} webUrl={webUrl} imConfig={imConfig} copiedShare={copiedShare}
          onCopy={(key, text) => {
            navigator.clipboard.writeText(text);
            setCopiedShare(key);
            setTimeout(() => setCopiedShare(null), 1500);
          }} />
        <InviteMeta invite={invite} roles={roles} mcpServers={mcpServers} skills={skills} pages={pages}
          skillsDropdownOpen={skillsDropdownOpen} skillsDropdownRef={skillsDropdownRef}
          onUpdate={onUpdate} onToggleSkillsDropdown={() => setSkillsDropdownOpen((v) => !v)} />
      </div>

      <InviteTextSection title="Greeting" value={greetingDraft} dirty={greetingDirty} rows={2}
        placeholder="AI's first message when visitor enters."
        onChange={(v) => { setGreetingDraft(v); setGreetingDirty(true); }}
        onSave={() => { onUpdate(invite.code, { greeting: greetingDraft }); setGreetingDirty(false); }}
        onCancel={() => { setGreetingDraft(invite.greeting ?? ""); setGreetingDirty(false); }} />

      <InviteTextSection title="Prompt" value={promptDraft} dirty={promptDirty} rows={4}
        placeholder="Custom system prompt for this visitor's AI chat."
        onChange={(v) => { setPromptDraft(v); setPromptDirty(true); }}
        onSave={() => { onUpdate(invite.code, { prompt: promptDraft }); setPromptDirty(false); }}
        onCancel={() => { setPromptDraft(invite.prompt ?? ""); setPromptDirty(false); }} />

      <div className="invite-detail-section">
        <div className="invite-detail-section-header">
          <span className="invite-detail-section-title">Chat Test <span className="invite-detail-hint" data-tip="Not saved, for testing only.">?</span></span>
        </div>
        {!gatewayUrl ? (
          <div className="invite-detail-gateway-notice">
            <p>Gateway URL not configured.</p>
            {onNavigateToSetup && <button className="small primary" onClick={onNavigateToSetup}>Go to Server Setup</button>}
          </div>
        ) : !invite.is_active ? (
          <p className="muted" style={{ padding: 0, fontSize: 13 }}>Chat test is not available for revoked invites.</p>
        ) : (
          <ChatTestPanel key={invite.code} gatewayUrl={gatewayUrl} authPayload={authPayload} onNavigateToContent={onNavigateToContent} />
        )}
      </div>

      <ChatLogPanel inviteCode={invite.code} gatewayUrl={gatewayUrl} ownerToken={ownerToken} hasReportSkill={hasReportSkill} />

      <InviteActions invite={invite} roles={roles} skills={skills} mcpServers={mcpServers}
        onRevoke={onRevoke} onDelete={onDelete} />
    </div>
  );
}

function InviteTextSection({ title, value, dirty, rows, placeholder, onChange, onSave, onCancel }: {
  title: string; value: string; dirty: boolean; rows: number; placeholder: string;
  onChange: (v: string) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="invite-detail-section">
      <div className="invite-detail-section-header">
        <span className="invite-detail-section-title">{title}</span>
      </div>
      <div className="invite-prompt-edit">
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} />
        {dirty && (
          <div className="button-row" style={{ marginTop: 8 }}>
            <button className="small primary" onClick={onSave}>Save</button>
            <button className="small" onClick={onCancel}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteActions({ invite, roles, skills, mcpServers, onRevoke, onDelete }: {
  invite: InviteCode; roles: Role[]; skills: Skill[]; mcpServers: McpServer[];
  onRevoke: (code: string) => void; onDelete: (code: string) => void;
}) {
  const handleExport = () => {
    const roleName = invite.role_id ? roles.find((r) => r.id === invite.role_id)?.name ?? null : null;
    const skillNames = invite.skill_ids.map((id) => skills.find((s) => s.id === id)?.name).filter(Boolean);
    const mcpNames = invite.mcp_server_ids.map((id) => mcpServers.find((m) => m.id === id)?.name).filter(Boolean);
    window.standmeet.data.saveJsonToFile({
      label: invite.label, role_name: roleName, prompt: invite.prompt, greeting: invite.greeting,
      max_uses: invite.max_uses, max_messages_per_session: invite.max_messages_per_session,
      mcp_server_names: mcpNames, skill_names: skillNames,
    }, `invite-${invite.label}`);
  };

  const handleConfirmDelete = () => {
    if (!confirm("Delete this invite permanently?")) return;
    onDelete(invite.code);
  };

  return (
    <div className="invite-detail-section">
      <div className="button-row" style={{ marginTop: 0 }}>
        {invite.is_active && (
          <button data-testid="invite-revoke-btn" className="small" onClick={() => onRevoke(invite.code)}>Revoke</button>
        )}
        <button className="small" onClick={handleExport}>Export</button>
        <button data-testid="invite-delete-btn" className="small danger" onClick={handleConfirmDelete}>Delete</button>
      </div>
    </div>
  );
}
