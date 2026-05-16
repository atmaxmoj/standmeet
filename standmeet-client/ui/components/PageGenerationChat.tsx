import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface ToolEvent {
  tool: string;
  args?: Record<string, unknown>;
  status: "start" | "done";
}

interface PageGenerationChatProps {
  gatewayUrl: string;
  ownerToken: string;
  pageId: string;
  roleId: string | null;
  packages: string[];
  onFilesWritten?: () => void;
}

type ServerMessage =
  | { type: "auth_ok"; label: string }
  | { type: "auth_error"; error: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; tool: string; status: "start" | "done"; args?: Record<string, unknown> }
  | { type: "message_done"; content: string }
  | { type: "error"; error: string };

function toolDisplayName(tool: string): string {
  return tool.replace(/^mcp__page-builder__/, "").replace(/^mcp__standmeet__/, "");
}

function toolStatusText(tool: string, args?: Record<string, unknown>): string {
  const name = toolDisplayName(tool);
  if (name === "list_content") return `Listing content${args?.prefix ? ` (${args.prefix})` : ""}`;
  if (name === "read_content" && args?.path) return `Reading ${args.path}`;
  if (name === "list_assets") return "Listing assets";
  if (name === "get_asset_url" && args?.path) return `Getting URL for ${args.path}`;
  if (name === "write_page_files") return "Writing page files";
  return name;
}

function friendlyToolStatus(tool: string): string {
  const name = toolDisplayName(tool);
  if (name === "write_page_files") return "Saving page code";
  if (name.includes("list") || name.includes("search")) return "Looking things up";
  if (name.includes("read") || name.includes("get")) return "Reading data";
  return "Working";
}

function chatStorageKey(pageId: string) {
  return `page-chat-${pageId}`;
}

function loadMessages(pageId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(chatStorageKey(pageId));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return [];
}

function saveMessages(pageId: string, messages: ChatMessage[]) {
  // Strip streaming flag before persisting
  const cleaned = messages.map(({ isStreaming: _, ...rest }) => rest);
  localStorage.setItem(chatStorageKey(pageId), JSON.stringify(cleaned));
}

function usePageGenerationWs(
  gatewayUrl: string, ownerToken: string,
  pageId: string, roleId: string | null, packages: string[],
  onFilesWritten?: () => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(pageId));
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTool, setActiveTool] = useState<{ tool: string; args?: Record<string, unknown> } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Serialize packages to avoid reconnecting on every render due to new array references
  const packagesJson = JSON.stringify(packages);

  // Reload messages from localStorage when pageId changes
  useEffect(() => {
    setMessages(loadMessages(pageId));
  }, [pageId]);

  useEffect(() => {
    const pkgs = JSON.parse(packagesJson);
    const ws = new WebSocket(gatewayUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "auth",
        owner_token: ownerToken,
        preview_mode: "page_generate",
        page_id: pageId,
        role_id: roleId,
        packages: pkgs,
      }));
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);

      if (msg.type === "auth_ok") {
        setConnected(true);
        setError("");
        inputRef.current?.focus();
      } else if (msg.type === "auth_error") {
        setError(msg.error);
      } else if (msg.type === "text_delta") {
        setActiveTool(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + msg.text }];
          }
          return [...prev, { role: "assistant", content: msg.text, isStreaming: true }];
        });
      } else if (msg.type === "tool_use") {
        setToolEvents((prev) => [...prev, { tool: msg.tool, args: msg.args, status: msg.status }]);
        if (msg.status === "start") {
          setActiveTool({ tool: msg.tool, args: msg.args });
        } else {
          setActiveTool(null);
          if (toolDisplayName(msg.tool) === "write_page_files") {
            onFilesWritten?.();
          }
        }
      } else if (msg.type === "message_done") {
        setActiveTool(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          let updated: ChatMessage[];
          if (last?.role === "assistant" && last.isStreaming) {
            updated = [...prev.slice(0, -1), { role: "assistant", content: msg.content }];
          } else {
            updated = [...prev, { role: "assistant", content: msg.content }];
          }
          saveMessages(pageId, updated);
          return updated;
        });
        setSending(false);
      } else if (msg.type === "error") {
        setError(msg.error);
        setSending(false);
      }
    };

    ws.onerror = () => { setError("WebSocket connection error"); };
    ws.onclose = () => { setConnected(false); };

    return () => { ws.close(); };
  }, [gatewayUrl, ownerToken, pageId, roleId, packagesJson]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !wsRef.current || sending) return;
    setMessages((prev) => {
      const updated = [...prev, { role: "user" as const, content: text }];
      saveMessages(pageId, updated);
      return updated;
    });
    wsRef.current.send(JSON.stringify({ type: "message", content: text }));
    setInput("");
    setSending(true);
  };

  const clearChat = useCallback(() => {
    setMessages([]);
    setToolEvents([]);
    localStorage.removeItem(chatStorageKey(pageId));
  }, [pageId]);

  return {
    messages, toolEvents, input, setInput, connected, error,
    sending, activeTool, inputRef, handleSend, clearChat,
  };
}

function PageChatMessages({
  messages, activeTool, sending, connected, messagesEndRef,
}: {
  messages: ChatMessage[];
  activeTool: { tool: string; args?: Record<string, unknown> } | null;
  sending: boolean;
  connected: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="chat-dialog-messages">
      {messages.length === 0 && connected && (
        <p className="chat-dialog-empty">
          Describe the page you want to create. For example: &quot;Create a portfolio page
          showing my projects and a brief bio, with a chat widget for questions.&quot;
        </p>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
          <div className={`chat-bubble chat-bubble-${msg.role}`}>
            {msg.role === "user" ? (
              msg.content
            ) : (
              <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                {msg.content}
              </ReactMarkdown>
            )}
            {msg.isStreaming && <span className="chat-cursor" />}
          </div>
        </div>
      ))}
      {activeTool && (
        <div className="chat-tool-status">
          <span className="chat-tool-dot" />
          {friendlyToolStatus(activeTool.tool)}...
        </div>
      )}
      {sending && !activeTool && !messages[messages.length - 1]?.isStreaming && (
        <div className="chat-thinking">
          <span className="chat-thinking-dots">
            <span /><span /><span />
          </span>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function PageDiagnosticsPanel({ toolEvents }: { toolEvents: ToolEvent[] }) {
  const filesWritten = toolEvents.filter(
    (e) => toolDisplayName(e.tool) === "write_page_files" && e.status === "done",
  ).length;

  return (
    <div className="chat-dialog-diag">
      <h4>Generation Status</h4>
      {filesWritten > 0 ? (
        <p className="chat-dialog-diag-empty" style={{ color: "var(--green, #16a34a)" }}>
          Page files saved ({filesWritten} write{filesWritten > 1 ? "s" : ""})
        </p>
      ) : (
        <p className="chat-dialog-diag-empty">No files generated yet.</p>
      )}

      <h4>Tool Activity</h4>
      {toolEvents.length === 0 ? (
        <p className="chat-dialog-diag-empty">No tool calls yet.</p>
      ) : (
        <ul className="chat-dialog-tools">
          {toolEvents.map((evt, i) => (
            <li key={i} className={`chat-tool-item chat-tool-${evt.status}`}>
              <span className="chat-tool-status">{evt.status === "start" ? "..." : "ok"}</span>
              <span className="chat-tool-text">{toolStatusText(evt.tool, evt.args)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PageGenerationChat({
  gatewayUrl, ownerToken, pageId, roleId, packages, onFilesWritten,
}: PageGenerationChatProps) {
  const ws = usePageGenerationWs(gatewayUrl, ownerToken, pageId, roleId, packages, onFilesWritten);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [ws.messages, ws.sending, ws.activeTool, scrollToBottom]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ws.handleSend();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-body">
        <div className="chat-panel-chat">
          <PageChatMessages
            messages={ws.messages}
            activeTool={ws.activeTool}
            sending={ws.sending}
            connected={ws.connected}
            messagesEndRef={messagesEndRef}
          />
          {ws.error && <div className="alert error chat-dialog-error">{ws.error}</div>}
          <div className="chat-dialog-input">
            <textarea
              ref={ws.inputRef}
              value={ws.input}
              onChange={(e) => ws.setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={ws.connected ? "Describe your page..." : "Connecting..."}
              disabled={!ws.connected || ws.sending}
              rows={2}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="primary small" onClick={ws.handleSend} disabled={!ws.connected || ws.sending || !ws.input.trim()}>
                Send
              </button>
              {ws.messages.length > 0 && (
                <button className="small" onClick={ws.clearChat} disabled={ws.sending} title="Clear chat history">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
        <PageDiagnosticsPanel toolEvents={ws.toolEvents} />
      </div>
    </div>
  );
}
