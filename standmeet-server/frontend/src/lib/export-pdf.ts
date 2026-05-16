import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";

/** PDF report styles — mirrors chat-bubble-assistant look but sized for print. */
const REPORT_CSS = `
  .report-root {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #111;
    padding: 0;
  }
  .report-root h1.report-title {
    font-size: 22pt;
    font-weight: 700;
    margin: 0 0 4px 0;
  }
  .report-root .report-date {
    font-size: 10pt;
    color: #888;
    margin: 0 0 24px 0;
  }
  .report-body {
    font-size: 12pt;
    line-height: 1.7;
  }
  .report-body h1 { font-size: 16pt; font-weight: 700; margin: 20px 0 8px; page-break-after: avoid; }
  .report-body h2 { font-size: 14pt; font-weight: 600; margin: 18px 0 6px; page-break-after: avoid; }
  .report-body h3 { font-size: 13pt; font-weight: 600; margin: 16px 0 6px; page-break-after: avoid; }
  .report-body h4 { font-size: 12pt; font-weight: 600; margin: 14px 0 4px; page-break-after: avoid; }
  .report-body p { margin: 6px 0; page-break-inside: avoid; }
  .report-body ul, .report-body ol { margin: 6px 0; padding-left: 22px; }
  .report-body li { margin: 3px 0; page-break-inside: avoid; }
  .report-body strong { font-weight: 600; }
  .report-body em { font-style: italic; }
  .report-body a { color: #0066cc; text-decoration: underline; }
  .report-body blockquote {
    border-left: 3px solid #ccc;
    margin: 8px 0;
    padding: 2px 0 2px 12px;
    color: #555;
    page-break-inside: avoid;
  }
  .report-body code {
    background: #f5f5f5;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 0.9em;
  }
  .report-body pre {
    background: #f5f5f5;
    padding: 10px 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
    page-break-inside: avoid;
  }
  .report-body pre code { background: none; padding: 0; font-size: 0.85em; }
  .report-body table { border-collapse: collapse; margin: 8px 0; font-size: 11pt; width: 100%; page-break-inside: avoid; }
  .report-body th, .report-body td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  .report-body th { background: #f5f5f5; font-weight: 600; }
  .report-body hr { border: none; border-top: 1px solid #ddd; margin: 14px 0; }
`;

export async function exportReportPdf(summary: string): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;

  const date = new Date();
  const dateStr = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Build container with embedded styles
  const container = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = REPORT_CSS;
  container.appendChild(style);

  const rootDiv = document.createElement("div");
  rootDiv.className = "report-root";
  rootDiv.innerHTML = `
    <h1 class="report-title">Conversation Report</h1>
    <p class="report-date">${dateStr} at ${timeStr}</p>
  `;
  container.appendChild(rootDiv);

  // Render markdown using the same React pipeline as chat messages
  const bodyDiv = document.createElement("div");
  bodyDiv.className = "report-body";
  rootDiv.appendChild(bodyDiv);

  const root = createRoot(bodyDiv);
  flushSync(() => {
    root.render(
      createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [rehypeRaw, rehypeKatex],
        children: summary,
      }),
    );
  });

  document.body.appendChild(container);

  const fileName = `conversation-report-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}.pdf`;

  try {
    await (html2pdf() as any)
      .from(container)
      .set({
        margin: 15,
        filename: fileName,
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css"] },
      })
      .save();
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}
