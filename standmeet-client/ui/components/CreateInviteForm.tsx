import { useState } from "react";

interface Props {
  roles: Role[];
  onCreated: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}

export default function CreateInviteForm({ roles, onCreated, onCancel, onError }: Props) {
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresHours, setExpiresHours] = useState("24");
  const [maxMessagesPerSession, setMaxMessagesPerSession] = useState("");
  const [prompt, setPrompt] = useState("");
  const [greeting, setGreeting] = useState("");
  const [roleId, setRoleId] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await window.standmeet.invite.create({
        label,
        max_uses: maxUses ? parseInt(maxUses, 10) : undefined,
        max_messages_per_session: maxMessagesPerSession ? parseInt(maxMessagesPerSession, 10) : undefined,
        expires_in_hours: parseInt(expiresHours, 10),
        prompt: prompt || undefined,
        greeting: greeting || undefined,
        role_id: roleId || undefined,
      });
      onCreated();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="invite-detail">
      <div className="invite-detail-section">
        <h3>Create Invite</h3>
      </div>
      <div className="invite-detail-section">
        <div className="form-group">
          <label htmlFor="invite-label">Label</label>
          <input id="invite-label" data-testid="invite-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Team member" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="invite-max-uses">Max Sessions</label>
            <input id="invite-max-uses" data-testid="invite-max-uses" type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" />
            <span className="hint">Optional. How many visitors can use this invite.</span>
          </div>
          <div className="form-group">
            <label htmlFor="invite-expires">Expires In (hours)</label>
            <input id="invite-expires" data-testid="invite-expires" type="number" value={expiresHours} onChange={(e) => setExpiresHours(e.target.value)} min="1" />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="invite-max-messages">Max Messages per Session</label>
          <input id="invite-max-messages" data-testid="invite-max-messages" type="number" value={maxMessagesPerSession} onChange={(e) => setMaxMessagesPerSession(e.target.value)} placeholder="Unlimited" />
          <span className="hint">Optional. Max messages a visitor can send per session.</span>
        </div>
        <div className="form-group">
          <label htmlFor="invite-greeting">Greeting</label>
          <textarea id="invite-greeting" data-testid="invite-greeting" value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Optional. AI's first message when visitor enters." rows={2} />
        </div>
        <div className="form-group">
          <label htmlFor="invite-prompt">AI Prompt</label>
          <textarea id="invite-prompt" data-testid="invite-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Optional. Custom system prompt for this visitor's AI chat." rows={3} />
        </div>
        <div className="form-group">
          <label htmlFor="invite-role">Role</label>
          {roles.length === 0 ? (
            <p className="hint">Create a role in IAM first</p>
          ) : (
            <select id="invite-role" data-testid="invite-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name} ({role.permissions.length} rules)</option>
              ))}
            </select>
          )}
        </div>
        <div className="button-row" style={{ justifyContent: "flex-end" }}>
          <button className="small" onClick={onCancel}>Cancel</button>
          <button data-testid="invite-create-btn" className="primary" onClick={handleCreate} disabled={!label || !expiresHours || creating}>
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
