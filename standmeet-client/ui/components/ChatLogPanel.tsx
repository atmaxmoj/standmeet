import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

interface Props {
  inviteCode: string;
  gatewayUrl: string;
  ownerToken: string;
  hasReportSkill: boolean;
}

const ownerSummaryPrompt =
  "Generate a concise conversation summary from the owner's perspective " +
  "(max 600 words, must fit 1-2 printed pages).\n\n" +
  "Structure:\n" +
  "1. **Visitor Profile** — 2-3 sentences: who the visitor seems to be and their likely purpose\n" +
  "2. **Topics of Interest** — 3-5 bullet points of what the visitor was most interested in\n" +
  "3. **Key Insights** — 3-5 bullet points of notable observations about the visitor's needs or intent\n" +
  "4. **Suggested Follow-up** — if applicable, 2-3 actionable items for the owner\n\n" +
  "Rules:\n" +
  "- Write from the owner's perspective — focus on understanding the visitor's intent and needs\n" +
  "- Do NOT reproduce the full conversation transcript\n" +
  '- Write in third person ("The visitor asked about...", "They seemed particularly interested in...")\n' +
  "- Be concise — every sentence should add value\n" +
  "- Professional tone, suitable for CRM or follow-up notes";

function groupAndSort(logs: ChatLog[]) {
  const groups = new Map<string, ChatLog[]>();
  for (const log of logs) {
    const key = log.session_id || "unknown";
    const arr = groups.get(key);
    if (arr) arr.push(log);
    else groups.set(key, [log]);
  }
  return Array.from(groups.entries()).sort((a, b) => {
    const aTime = a[1][0]?.created_at ?? "";
    const bTime = b[1][0]?.created_at ?? "";
    return bTime.localeCompare(aTime);
  });
}

function useChatLogs(inviteCode: string, gatewayUrl: string, ownerToken: string, hasReportSkill: boolean) {
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [summarizingSession, setSummarizingSession] = useState<string | null>(null);
  const [sessionSummaries, setSessionSummaries] = useState<Map<string, string>>(new Map());

  const sessionGroups = useMemo(() => groupAndSort(logs), [logs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.standmeet.invite.chatLogs(inviteCode);
        if (cancelled) return;
        setLogs(result.logs);
        if (result.summaries && Object.keys(result.summaries).length > 0) {
          setSessionSummaries(new Map(Object.entries(result.summaries)));
        }
        const sorted = groupAndSort(result.logs);
        const latest = sorted[0]?.[0];
        if (latest) setExpandedSessions(new Set([latest]));
      } finally {
        if (!cancelled) setLogsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [inviteCode]);

  const refreshLogs = async () => {
    setLogsLoading(true);
    try {
      const result = await window.standmeet.invite.chatLogs(inviteCode);
      setLogs(result.logs);
      if (result.summaries && Object.keys(result.summaries).length > 0) {
        setSessionSummaries(new Map(Object.entries(result.summaries)));
      }
      const sorted = groupAndSort(result.logs);
      const latest = sorted[sorted.length - 1]?.[0];
      if (latest) setExpandedSessions(new Set([latest]));
    } finally {
      setLogsLoading(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    await window.standmeet.invite.deleteChatLog(inviteCode, logId);
    setLogs((prev) => prev.filter((l) => l.id !== logId));
  };

  const handleClearLogs = async () => {
    await window.standmeet.invite.clearChatLogs(inviteCode);
    setLogs([]);
    setSessionSummaries(new Map());
  };

  const handleGenerateSummary = async (sessionId: string, sessionLogs: ChatLog[]) => {
    if (!gatewayUrl || !hasReportSkill) return;
    setSummarizingSession(sessionId);
    setExpandedSessions((prev) => new Set(prev).add(sessionId));
    try {
      const messages = sessionLogs.flatMap((log) => [
        { role: "user", content: log.user_message },
        { role: "assistant", content: log.assistant_message },
      ]);
      const url = `${gatewayUrl.replace(/^ws/, "http")}/api/generate-report`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ messages, prompt: ownerSummaryPrompt }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to generate report: ${res.status} ${errBody}`);
      }
      const data = await res.json();
      setSessionSummaries((prev) => new Map(prev).set(sessionId, data.summary));
      window.standmeet.invite.saveSummary(inviteCode, sessionId, data.summary).catch((err: unknown) => {
        console.error("[Summarize] failed to persist summary:", err);
      });
      setTimeout(() => {
        document.querySelector(`[data-summary="${sessionId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (err) {
      console.error("[Summarize] failed:", err);
    } finally {
      setSummarizingSession(null);
    }
  };

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  return {
    logs, logsLoading, expandedSessions, summarizingSession,
    sessionSummaries, sessionGroups,
    refreshLogs, handleDeleteLog, handleClearLogs,
    handleGenerateSummary, toggleSession,
  };
}

function SessionHeaderRow({
  sessionId, sessionLogs, isExpanded,
  hasReportSkill, hasSummary, isSummarizing,
  onToggle, onSummarize,
}: {
  sessionId: string; sessionLogs: ChatLog[]; isExpanded: boolean;
  hasReportSkill: boolean; hasSummary: boolean; isSummarizing: boolean;
  onToggle: () => void;
  onSummarize: () => void;
}) {
  const shortId = sessionId === "unknown" ? "Unknown" : sessionId.slice(0, 8);
  const firstTime = new Date(sessionLogs[0].created_at).toLocaleString();

  return (
    <div className="chat-log-session-header-row">
      <button className="chat-log-session-header" onClick={onToggle}>
        <span className="chat-log-session-toggle">{isExpanded ? "\u25BC" : "\u25B6"}</span>
        <span className="chat-log-session-title">
          Session {shortId} ({sessionLogs.length} messages) &mdash; {firstTime}
        </span>
      </button>
      {hasReportSkill && !hasSummary && !isSummarizing && (
        <button
          className="small chat-log-summarize-btn"
          onClick={(e) => { e.stopPropagation(); onSummarize(); }}
        >
          Summarize
        </button>
      )}
      {isSummarizing && (
        <div className="chat-log-generating">
          <span className="chat-log-generating-spinner" />
          Generating...
        </div>
      )}
    </div>
  );
}

export default function ChatLogPanel({ inviteCode, gatewayUrl, ownerToken, hasReportSkill }: Props) {
  const state = useChatLogs(inviteCode, gatewayUrl, ownerToken, hasReportSkill);
  const [summaryPanelRatio, setSummaryPanelRatio] = useState(0.6);
  const dragRef = useRef<{ startX: number; startRatio: number; containerWidth: number } | null>(null);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.target as HTMLElement).closest(".chat-log-session-body") as HTMLElement | null;
    if (!container) return;
    dragRef.current = { startX: e.clientX, startRatio: summaryPanelRatio, containerWidth: container.offsetWidth };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const deltaRatio = dx / dragRef.current.containerWidth;
      const newRatio = Math.min(0.8, Math.max(0.2, dragRef.current.startRatio - deltaRatio));
      setSummaryPanelRatio(newRatio);
    };
    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [summaryPanelRatio]);

  const { logs, logsLoading, sessionGroups } = state;

  return (
    <div className="invite-detail-section">
      <div className="invite-detail-section-header">
        <span className="invite-detail-section-title">Chat Logs</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="small" onClick={state.refreshLogs} disabled={logsLoading}>
            {logsLoading ? "Loading..." : "Refresh"}
          </button>
          {logs.length > 0 && (
            <button className="small danger" onClick={state.handleClearLogs}>Clear All</button>
          )}
        </div>
      </div>
      <div className="chat-logs" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
        {logsLoading ? (
          <p className="muted" style={{ padding: 0, fontSize: 13 }}>Loading...</p>
        ) : logs.length === 0 ? (
          <p className="empty-message">No chat logs yet.</p>
        ) : (
          <div className="chat-log-list">
            {sessionGroups.map(([sessionId, sessionLogs]) => (
              <div key={sessionId} className="chat-log-session">
                <SessionHeaderRow
                  sessionId={sessionId}
                  sessionLogs={sessionLogs}
                  isExpanded={state.expandedSessions.has(sessionId)}
                  hasReportSkill={hasReportSkill}
                  hasSummary={state.sessionSummaries.has(sessionId)}
                  isSummarizing={state.summarizingSession === sessionId}
                  onToggle={() => state.toggleSession(sessionId)}
                  onSummarize={() => state.handleGenerateSummary(sessionId, sessionLogs)}
                />
                {state.expandedSessions.has(sessionId) && (
                  <SessionBody
                    sessionId={sessionId}
                    sessionLogs={sessionLogs}
                    summary={state.sessionSummaries.get(sessionId)}
                    summaryPanelRatio={summaryPanelRatio}
                    hasReportSkill={hasReportSkill}
                    isSummarizing={state.summarizingSession === sessionId}
                    onDividerMouseDown={handleDividerMouseDown}
                    onDeleteLog={state.handleDeleteLog}
                    onResummarize={() => state.handleGenerateSummary(sessionId, sessionLogs)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionBody({
  sessionId, sessionLogs, summary, summaryPanelRatio,
  hasReportSkill, isSummarizing,
  onDividerMouseDown, onDeleteLog, onResummarize,
}: {
  sessionId: string;
  sessionLogs: ChatLog[];
  summary: string | undefined;
  summaryPanelRatio: number;
  hasReportSkill: boolean;
  isSummarizing: boolean;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  onDeleteLog: (logId: string) => void;
  onResummarize: () => void;
}) {
  return (
    <div className={`chat-log-session-body ${summary ? "has-summary" : ""}`}>
      <div
        className="chat-log-messages-col"
        style={summary ? { flex: `0 0 ${((1 - summaryPanelRatio) * 100).toFixed(1)}%` } : undefined}
      >
        {sessionLogs.map((log) => (
          <div key={log.id} className="chat-log-item">
            <div className="chat-log-messages">
              <div className="chat-log-user"><strong>User:</strong> {log.user_message}</div>
              <div className="chat-log-assistant">
                <strong>AI:</strong>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{log.assistant_message}</ReactMarkdown>
              </div>
            </div>
            <div className="chat-log-footer">
              <span className="chat-log-time">{new Date(log.created_at).toLocaleString()}</span>
              <button className="small danger" onClick={() => onDeleteLog(log.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {summary && (
        <>
          <div className="chat-log-divider" onMouseDown={onDividerMouseDown} />
          <div
            className="chat-log-summary"
            data-summary={sessionId}
            style={{ flex: `0 0 ${(summaryPanelRatio * 100).toFixed(1)}%` }}
          >
            <div className="chat-log-summary-header">
              <span>Summary</span>
              {hasReportSkill && !isSummarizing && (
                <button className="small chat-log-resummarize-btn" onClick={onResummarize}>Resummarize</button>
              )}
            </div>
            <div className="chat-log-summary-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{summary}</ReactMarkdown>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
