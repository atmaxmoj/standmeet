"use client";

import ReactMarkdown from "react-markdown";
import type { ViewingContent } from "@/hooks/use-chat";

interface ContentViewerProps {
  content: ViewingContent;
  onClose: () => void;
}

function renderValue(value: unknown): React.ReactNode {
  if (typeof value === "string") {
    // If the string looks like it has markdown (headings, bold, lists, links),
    // render as markdown; otherwise plain text
    if (/^#{1,3}\s|[*_]{1,2}\S|\n-\s|\n\d+\.\s|\[.+\]\(/.test(value)) {
      return (
        <div className="content-viewer-markdown">
          <ReactMarkdown>{value}</ReactMarkdown>
        </div>
      );
    }
    return <span className="content-viewer-kv-value">{value}</span>;
  }
  if (typeof value === "object" && value !== null) {
    return (
      <pre className="content-viewer-kv-value" style={{ fontFamily: "monospace", fontSize: 13 }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="content-viewer-kv-value">{String(value)}</span>;
}

function renderContent(content: string, contentType: string) {
  // Try to parse as JSON for key-value display
  if (contentType.includes("json")) {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed);
        return (
          <div className="content-viewer-kv">
            {entries.map(([key, value]) => (
              <div key={key} className="content-viewer-kv-row">
                <span className="content-viewer-kv-key">{key}</span>
                {renderValue(value)}
              </div>
            ))}
          </div>
        );
      }
    } catch {
      // Not valid JSON, fall through to markdown
    }
  }

  // Default: render as markdown (handles plain text gracefully too)
  return (
    <div className="content-viewer-markdown">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

export function ContentViewer({ content, onClose }: ContentViewerProps) {
  if (!content) return null;

  return (
    <>
      <div className="content-viewer-overlay" onClick={onClose} />
      <div className="content-viewer-panel">
        <div className="content-viewer-header">
          <span className="content-viewer-title" title={content.path}>
            {content.title}
          </span>
          <button className="content-viewer-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="content-viewer-body">
          {renderContent(content.content, content.contentType)}
        </div>
      </div>
    </>
  );
}
