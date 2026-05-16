import { useState } from "react";

export default function MarketplaceTab() {
  const [url, setUrl] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setInstalling(true);
    setError("");
    setSuccess("");
    try {
      const skill = await window.standmeet.skill.importUrl(url.trim());
      setSuccess(`Installed "${skill.name}" successfully.`);
      setUrl("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to install skill from URL");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="iam-page" style={{ flex: 1 }}>
      <div className="iam-detail">
        <div className="iam-edit-panel">
          <h3 style={{ marginTop: 0 }}>Install from URL</h3>
          <p className="hint" style={{ marginBottom: 16 }}>
            Paste a direct link to a <code>SKILL.md</code> file (raw GitHub URL) to install it.
          </p>
          <form onSubmit={handleInstall} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              data-testid="marketplace-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/.../SKILL.md"
              style={{ flex: 1, padding: "8px 12px" }}
            />
            <button data-testid="marketplace-install-btn" className="primary" type="submit" disabled={installing || !url.trim()}>
              {installing ? "Installing..." : "Install"}
            </button>
          </form>
          {error && <div data-testid="marketplace-error" className="alert error" style={{ marginBottom: 12 }}>{error}</div>}
          {success && <div data-testid="marketplace-success" className="alert" style={{ marginBottom: 12, background: "var(--bg-secondary, #f0f9f0)", border: "1px solid #27ae60", color: "#27ae60" }}>{success}</div>}

          <h3>What is a Skill?</h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            A skill is a <code>SKILL.md</code> file that teaches the AI how to behave — custom instructions, persona, knowledge, or conversational rules.
          </p>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            <p style={{ margin: "0 0 8px" }}>To create a skill, write a <code>SKILL.md</code> with YAML frontmatter and markdown body:</p>
            <pre style={{ background: "var(--hover, #f5f5f5)", padding: "10px 12px", borderRadius: 6, fontSize: 12, overflow: "auto", margin: "0 0 12px" }}>{`---
name: My Custom Skill
description: Short description
---

# Instructions

Your markdown instructions here...`}</pre>
            <p style={{ margin: 0 }}>
              Host it anywhere (GitHub Gist, your own server) and paste the raw URL above to install.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
