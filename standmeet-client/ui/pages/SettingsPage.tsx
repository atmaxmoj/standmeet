import { useState, useEffect, useRef, useCallback } from "react";
import { ImIntegrationsSection, DataSection } from "./SettingsSection";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (settings) autoResize();
  }, [settings?.ai_system_prompt, autoResize]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await window.standmeet.settings.get();
      setSettings(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const updated = await window.standmeet.settings.update(settings);
      setSettings(updated);
      setSuccess("Settings saved");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page"><p className="muted">Loading...</p></div>;
  if (!settings) return <div className="page"><p className="muted">Failed to load settings</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
        <button data-testid="settings-save-btn" className="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <section className="settings-section">
        <h3>Access</h3>
        <div className="form-group">
          <div className="toggle-row">
            <input type="checkbox" id="toggle-public-access" checked={settings.public_access}
              onChange={(e) => setSettings({ ...settings, public_access: e.target.checked })} />
            <label htmlFor="toggle-public-access">Public Access</label>
            <span className="hint-trigger">
              ?
              <span className="hint-tooltip">Enable BYOAI mode. Visitors can connect their own AI (e.g. Claude Code) via the MCP endpoint using standard OAuth — no invite code needed. Only content marked as &quot;public&quot; in the Content page will be visible to them.</span>
            </span>
          </div>
        </div>
      </section>

      <ImIntegrationsSection
        integrations={settings.im_integrations ?? {}}
        onChange={(im) => setSettings({ ...settings, im_integrations: im })}
      />

      <section className="settings-section">
        <h3>AI</h3>
        <div className="form-group">
          <label htmlFor="ai-prompt">System Prompt</label>
          <textarea id="ai-prompt" ref={promptRef} value={settings.ai_system_prompt}
            onChange={(e) => { setSettings({ ...settings, ai_system_prompt: e.target.value }); autoResize(); }}
            onFocus={autoResize} rows={3} style={{ overflow: "hidden", resize: "none" }}
            placeholder="Custom system prompt for AI responses" />
        </div>
      </section>

      <DataSection />
    </div>
  );
}
