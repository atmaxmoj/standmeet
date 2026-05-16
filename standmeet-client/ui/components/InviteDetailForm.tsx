import { Globe } from "lucide-react";
import { SiTelegram, SiDiscord, SiSlack } from "react-icons/si";

interface ImConfig {
  telegram?: { botUsername: string };
  discord?: { applicationId: string };
  slack?: boolean;
}

export function ShareButtons({
  code, webUrl, imConfig, copiedShare, onCopy,
}: {
  code: string;
  webUrl?: string;
  imConfig: ImConfig;
  copiedShare: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const buttons: { key: string; label: string; icon: React.ReactNode; enabled: boolean; copyText: string; enabledTitle: string; disabledTitle: string }[] = [
    {
      key: "web", label: "Web", icon: <Globe size={14} />,
      enabled: !!webUrl,
      copyText: webUrl ? `${webUrl}/i/${code}` : "",
      enabledTitle: webUrl ? `${webUrl}/i/${code} — Visitor opens this URL to start chatting.` : "",
      disabledTitle: "Not available — Web URL not configured",
    },
    {
      key: "telegram", label: "Telegram", icon: <SiTelegram size={14} />,
      enabled: !!imConfig.telegram,
      copyText: imConfig.telegram ? `https://t.me/${imConfig.telegram.botUsername}?start=${code}` : "",
      enabledTitle: imConfig.telegram ? `t.me/${imConfig.telegram.botUsername}?start=${code} — Opens a private chat. For group chats, send the code directly in the group.` : "",
      disabledTitle: "Not configured — Enable in Settings → IM Integrations",
    },
    {
      key: "discord", label: "Discord", icon: <SiDiscord size={14} />,
      enabled: !!imConfig.discord,
      copyText: imConfig.discord
        ? `https://discord.com/oauth2/authorize?client_id=${imConfig.discord.applicationId}&permissions=68608&scope=bot\n\n1. Add the bot to your server with the link above\n2. Send \`${code}\` in any channel to connect\n3. @mention the bot to chat`
        : "",
      enabledTitle: "Copy bot install link + invite code instructions.",
      disabledTitle: "Not configured — Enable in Settings → IM Integrations and set Application ID",
    },
    {
      key: "slack", label: "Slack", icon: <SiSlack size={14} />,
      enabled: !!imConfig.slack,
      copyText: `${code}\nPaste this in a channel or DM to connect. Then @mention the bot to chat.`,
      enabledTitle: "Copy invite code with instructions for Slack.",
      disabledTitle: "Not configured — Enable in Settings → IM Integrations",
    },
  ];

  return (
    <div className="invite-share-row">
      <span className="invite-share-label">Share</span>
      {buttons.map((btn) => (
        <button
          key={btn.key}
          data-testid={`share-btn-${btn.key}`}
          className={`invite-share-btn${copiedShare === btn.key ? " copied" : ""}`}
          disabled={!btn.enabled}
          title={btn.enabled ? btn.enabledTitle : btn.disabledTitle}
          onClick={() => btn.enabled && onCopy(btn.key, btn.copyText)}
        >
          {btn.icon}
          {copiedShare === btn.key ? "Copied!" : btn.label}
        </button>
      ))}
    </div>
  );
}

export function InviteMeta({
  invite, roles, mcpServers, skills, pages,
  skillsDropdownOpen, skillsDropdownRef,
  onUpdate, onToggleSkillsDropdown,
}: {
  invite: InviteCode;
  roles: Role[];
  mcpServers: McpServer[];
  skills: Skill[];
  pages: PageListItem[];
  skillsDropdownOpen: boolean;
  skillsDropdownRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (code: string, data: Record<string, unknown>) => void;
  onToggleSkillsDropdown: () => void;
}) {
  return (
    <div className="invite-detail-meta">
      <SessionLimits invite={invite} onUpdate={onUpdate} />
      {invite.expires_at && (
        <div className="invite-detail-meta-item">
          <span className="invite-detail-meta-label">Expires</span>
          <span>{new Date(invite.expires_at).toLocaleDateString()}</span>
        </div>
      )}
      <RolePageSelectors invite={invite} roles={roles} pages={pages} onUpdate={onUpdate} />
      <McpServerCheckboxes invite={invite} mcpServers={mcpServers} onUpdate={onUpdate} />
      <SkillsDropdown
        invite={invite} skills={skills}
        skillsDropdownOpen={skillsDropdownOpen}
        skillsDropdownRef={skillsDropdownRef}
        onUpdate={onUpdate}
        onToggleSkillsDropdown={onToggleSkillsDropdown}
      />
    </div>
  );
}

function SessionLimits({ invite, onUpdate }: {
  invite: InviteCode;
  onUpdate: (code: string, data: Record<string, unknown>) => void;
}) {
  return (
    <>
      <div className="invite-detail-meta-item">
        <span className="invite-detail-meta-label">Sessions</span>
        <span className="invite-limit-field">
          {invite.use_count} /
          <input type="number" className="invite-limit-input"
            value={invite.max_uses ?? ""} placeholder="∞" min={invite.use_count || 0}
            onChange={(e) => {
              const val = e.target.value === "" ? null : Math.max(Number(e.target.value), invite.use_count || 0);
              onUpdate(invite.code, { max_uses: val });
            }} />
        </span>
      </div>
      <div className="invite-detail-meta-item">
        <span className="invite-detail-meta-label">Msgs / Session</span>
        <input type="number" className="invite-limit-input"
          value={invite.max_messages_per_session ?? ""} placeholder="Unlimited" min={1}
          onChange={(e) => {
            const val = e.target.value === "" ? null : Math.max(Number(e.target.value), 1);
            onUpdate(invite.code, { max_messages_per_session: val });
          }} />
      </div>
    </>
  );
}

function RolePageSelectors({ invite, roles, pages, onUpdate }: {
  invite: InviteCode; roles: Role[]; pages: PageListItem[];
  onUpdate: (code: string, data: Record<string, unknown>) => void;
}) {
  return (
    <>
      <div className="invite-detail-meta-item">
        <span className="invite-detail-meta-label">Role</span>
        <select value={invite.role_id ?? ""}
          onChange={(e) => onUpdate(invite.code, { role_id: e.target.value || null })}
          className="invite-role-select">
          <option value="">None</option>
          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
      </div>
      {pages.length > 0 && (
        <div className="invite-detail-meta-item">
          <span className="invite-detail-meta-label">Page</span>
          <select value={invite.page_id ?? ""}
            onChange={(e) => onUpdate(invite.code, { page_id: e.target.value || null })}
            className="invite-role-select">
            <option value="">No page (default chat)</option>
            {pages.filter(p => p.status === "ready").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

function McpServerCheckboxes({ invite, mcpServers, onUpdate }: {
  invite: InviteCode; mcpServers: McpServer[];
  onUpdate: (code: string, data: Record<string, unknown>) => void;
}) {
  if (mcpServers.length === 0) return null;
  return (
    <div className="invite-detail-meta-item">
      <span className="invite-detail-meta-label">MCP Servers</span>
      <div className="invite-mcp-checkboxes">
        {mcpServers.map((server) => (
          <label key={server.id} className="invite-mcp-checkbox">
            <input type="checkbox"
              checked={invite.mcp_server_ids?.includes(server.id) ?? false}
              onChange={(e) => {
                const current = invite.mcp_server_ids ?? [];
                const next = e.target.checked ? [...current, server.id] : current.filter((id) => id !== server.id);
                onUpdate(invite.code, { mcp_server_ids: next });
              }} />
            {server.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function SkillsDropdown({ invite, skills, skillsDropdownOpen, skillsDropdownRef, onUpdate, onToggleSkillsDropdown }: {
  invite: InviteCode; skills: Skill[];
  skillsDropdownOpen: boolean;
  skillsDropdownRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (code: string, data: Record<string, unknown>) => void;
  onToggleSkillsDropdown: () => void;
}) {
  if (skills.length === 0) return null;
  return (
    <div className="invite-detail-meta-item">
      <span className="invite-detail-meta-label">Skills</span>
      <div className="invite-skills-dropdown" ref={skillsDropdownRef}>
        <button type="button" className="invite-skills-dropdown-toggle" onClick={onToggleSkillsDropdown}>
          {(invite.skill_ids?.length ?? 0) > 0
            ? `${invite.skill_ids!.length} skill${invite.skill_ids!.length > 1 ? "s" : ""} selected`
            : "Select skills..."}
        </button>
        {skillsDropdownOpen && (
          <div className="invite-skills-dropdown-menu">
            {skills.map((skill) => {
              const checked = invite.skill_ids?.includes(skill.id) ?? false;
              return (
                <label key={skill.id} className="invite-skills-dropdown-item">
                  <input type="checkbox" checked={checked}
                    onChange={(e) => {
                      const current = invite.skill_ids ?? [];
                      const next = e.target.checked ? [...current, skill.id] : current.filter((id) => id !== skill.id);
                      onUpdate(invite.code, { skill_ids: next });
                    }} />
                  {skill.name}{skill.is_builtin ? " (built-in)" : ""}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
