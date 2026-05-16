"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getMcpConfig } from "@/lib/api-client";

type Tab = "claude-code" | "claude-desktop" | "qr-code";

interface Props {
  mcpUrl: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button className="copy-btn" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function ClaudeCodeTab({ mcpUrl }: { mcpUrl: string }) {
  const command = `claude mcp add standmeet --transport http ${mcpUrl}`;

  return (
    <div className="tab-content">
      <p className="tab-instruction">Run in your terminal:</p>
      <div className="code-block">
        <code>{command}</code>
        <CopyButton text={command} />
      </div>
      <p className="tab-hint">Then start a new conversation in Claude Code.</p>
    </div>
  );
}

function ClaudeDesktopTab({ mcpUrl }: { mcpUrl: string }) {
  const config = JSON.stringify(
    { mcpServers: { standmeet: { url: mcpUrl } } },
    null,
    2,
  );

  return (
    <div className="tab-content">
      <p className="tab-instruction">Add to your config file:</p>
      <p className="tab-hint" style={{ fontFamily: "monospace", fontSize: "12px" }}>
        ~/Library/Application Support/Claude/claude_desktop_config.json
      </p>
      <div className="code-block">
        <pre>{config}</pre>
        <CopyButton text={config} />
      </div>
      <p className="tab-hint">Restart Claude Desktop after saving.</p>
    </div>
  );
}

function QrCodeTab({ mcpUrl }: { mcpUrl: string }) {
  const mcpConfig = getMcpConfig();
  const configJson = JSON.stringify(mcpConfig);

  return (
    <div className="tab-content" style={{ alignItems: "center" }}>
      <p className="tab-instruction">Scan with any MCP-compatible AI assistant:</p>
      <QRCodeSVG value={configJson} size={200} level="M" />
      <p className="tab-instruction" style={{ marginTop: "8px" }}>
        Or copy the server URL:
      </p>
      <div className="code-block">
        <code>{mcpUrl}</code>
        <CopyButton text={mcpUrl} />
      </div>
    </div>
  );
}

const tabs: { key: Tab; label: string }[] = [
  { key: "claude-code", label: "Claude Code" },
  { key: "claude-desktop", label: "Claude Desktop" },
  { key: "qr-code", label: "QR Code" },
];

export function ConnectGuide({ mcpUrl }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("claude-code");

  return (
    <div className="connect-guide">
      <h2 className="connect-guide-title">Connect with your AI</h2>
      <div className="tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        {activeTab === "claude-code" && <ClaudeCodeTab mcpUrl={mcpUrl} />}
        {activeTab === "claude-desktop" && <ClaudeDesktopTab mcpUrl={mcpUrl} />}
        {activeTab === "qr-code" && <QrCodeTab mcpUrl={mcpUrl} />}
      </div>
    </div>
  );
}
