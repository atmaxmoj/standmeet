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

interface ChatTestPanelProps {
  gatewayUrl: string;
  authPayload: Record<string, unknown>;
  onNavigateToContent?: (path: string) => void;
  /** Called after navigating to content (e.g. to close a dialog) */
  onAfterNavigate?: () => void;
}

type ServerMessage =
  | { type: "auth_ok"; label: string }
  | { type: "auth_error"; error: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; tool: string; status: "start" | "done"; args?: Record<string, unknown> }
  | { type: "message_done"; content: string }
  | { type: "error"; error: string };

function extractContentPath(tool: string, args?: Record<string, unknown>): string | null {
  if (!args) return null;
  const toolName = tool.replace(/^mcp__standmeet__/, "");
  if (toolName === "read_content" && typeof args.path === "string") return args.path;
  if (toolName === "list_content" && typeof args.prefix === "string") return args.prefix || null;
  return null;
}

function toolDisplayName(tool: string): string {
  return tool.replace(/^mcp__standmeet__/, "");
}

function toolStatusText(tool: string, args?: Record<string, unknown>): string {
  const name = toolDisplayName(tool);
  if (name === "read_content" && args?.path) return `Reading ${args.path}`;
  if (name === "search_content" && args?.query) return `Searching "${args.query}"`;
  if (name === "list_content") return `Listing ${args?.prefix || "/"}`;
  return name;
}

function friendlyToolStatus(tool: string): string {
  const name = toolDisplayName(tool);
  if (name.includes("list") || name.includes("search")) return "Looking things up";
  if (name.includes("read")) return "Reading";
  return "Working";
}

function useChatWebSocket(gatewayUrl: string, authPayload: Record<string, unknown>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTool, setActiveTool] = useState<{ tool: string; args?: Record<string, unknown> } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Serialize authPayload to avoid reconnecting on every render due to new object references
  const authPayloadJson = JSON.stringify(authPayload);

  useEffect(() => {
    const payload = JSON.parse(authPayloadJson);
    const ws = new WebSocket(gatewayUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", ...payload }));
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
        }
      } else if (msg.type === "message_done") {
        setActiveTool(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            return [...prev.slice(0, -1), { role: "assistant", content: msg.content }];
          }
          return [...prev, { role: "assistant", content: msg.content }];
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
  }, [gatewayUrl, authPayloadJson]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !wsRef.current || sending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    wsRef.current.send(JSON.stringify({ type: "message", content: text }));
    setInput("");
    setSending(true);
  };

  return {
    messages, toolEvents, input, setInput, connected, error,
    sending, activeTool, inputRef, handleSend,
  };
}

function ChatMessages({
  messages, activeTool, sending, messagesEndRef,
}: {
  messages: ChatMessage[];
  activeTool: { tool: string; args?: Record<string, unknown> } | null;
  sending: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="chat-dialog-messages">
      {messages.length === 0 && (
        <p className="chat-dialog-empty">Send a message to start the conversation.</p>
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

function DiagnosticsPanel({
  toolEvents, referencedPaths, onPathClick,
}: {
  toolEvents: ToolEvent[];
  referencedPaths: string[];
  onPathClick: (path: string) => void;
}) {
  return (
    <div className="chat-dialog-diag">
      <h4>Referenced Content</h4>
      {referencedPaths.length === 0 ? (
        <p className="chat-dialog-diag-empty">No content referenced yet.</p>
      ) : (
        <ul className="chat-dialog-paths">
          {referencedPaths.map((path) => (
            <li key={path}>
              <button
                className="chat-dialog-path-link"
                onClick={() => onPathClick(path)}
                title={`Edit ${path}`}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
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

export default function ChatTestPanel({ gatewayUrl, authPayload, onNavigateToContent, onAfterNavigate }: ChatTestPanelProps) {
  const ws = useChatWebSocket(gatewayUrl, authPayload);
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

  const referencedPaths = Array.from(
    new Set(
      ws.toolEvents
        .map((e) => extractContentPath(e.tool, e.args))
        .filter((p): p is string => p !== null && p.length > 0),
    ),
  );

  const handlePathClick = (path: string) => {
    if (onNavigateToContent) {
      onNavigateToContent(path);
      onAfterNavigate?.();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-body">
        <div className="chat-panel-chat">
          <ChatMessages
            messages={ws.messages}
            activeTool={ws.activeTool}
            sending={ws.sending}
            messagesEndRef={messagesEndRef}
          />
          {ws.error && <div className="alert error chat-dialog-error">{ws.error}</div>}
          <div className="chat-dialog-input">
            <textarea
              ref={ws.inputRef}
              value={ws.input}
              onChange={(e) => ws.setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={ws.connected ? "Type a message..." : "Connecting..."}
              disabled={!ws.connected || ws.sending}
              rows={1}
            />
            <button className="primary small" onClick={ws.handleSend} disabled={!ws.connected || ws.sending || !ws.input.trim()}>
              Send
            </button>
          </div>
        </div>
        <DiagnosticsPanel
          toolEvents={ws.toolEvents}
          referencedPaths={referencedPaths}
          onPathClick={handlePathClick}
        />
      </div>
    </div>
  );
}
