import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { IncomingMessage } from "node:http";
import type { SessionStore } from "../session/store.js";
import type { QueryQueue } from "../session/query-queue.js";
import type { ConnectionManager } from "./connection-manager.js";
import { parseClientMessage, type ServerMessage } from "./protocol.js";
import { logChat } from "../django/chat-logger.js";
import { saveSession } from "../django/session-persistence.js";
import { runQuery } from "../runtime/claude.js";
import { generateSummary } from "../runtime/report.js";
import { isAllowed } from "../runtime/mcp-tools.js";
import { config } from "../config.js";
import { isRateLimited } from "./rate-limiter.js";
import { getClientIp } from "./helpers.js";
import {
  handleAuth as doAuth,
  handleOwnerPreview as doOwnerPreview,
  type ConnectionState,
} from "./auth-handler.js";

type SendFn = (msg: ServerMessage) => void;

type HandlerDeps = {
  state: ConnectionState;
  send: SendFn;
  sessionStore: SessionStore;
  queryQueue: QueryQueue;
  connectionManager: ConnectionManager;
};

async function handleFetchContent(path: string, deps: HandlerDeps) {
  const { state, send, sessionStore } = deps;
  const session = sessionStore.getSession(state.authenticatedSessionId!);
  if (!session) { send({ type: "content_error", path, error: "Session not found" }); return; }

  if (!state.isPublicOnly && !isAllowed(path, session.permissions)) {
    send({ type: "content_error", path, error: "Access denied" });
    return;
  }

  try {
    const res = await fetch(
      `${config.djangoUrl}/api/repo/${path.replace(/^\//, "")}/`,
      { headers: { Authorization: `Bearer ${config.ownerToken}` } },
    );
    if (!res.ok) { send({ type: "content_error", path, error: "Content not found" }); return; }

    const entry = await res.json();
    send({
      type: "content_data",
      path: entry.path,
      title: entry.path.split("/").pop() || entry.path,
      content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content, null, 2),
      content_type: entry.content_type || "application/json",
    });
  } catch {
    send({ type: "content_error", path, error: "Failed to fetch content" });
  }
}

function handleContext(content: string, author: string | undefined, deps: HandlerDeps) {
  const { state, sessionStore } = deps;
  const session = sessionStore.getSession(state.authenticatedSessionId!);
  if (!session) return;

  const label = author ? `[${author}]: ${content}` : content;
  session.messages.push({ role: "user", content: label });

  if (!state.skipChatLog && state.authenticatedInviteCode) {
    logChat(config.djangoUrl, config.ownerToken, state.authenticatedInviteCode, label, "", state.authenticatedSessionId!, undefined).catch(() => {});
  }
}

async function handleSummaryCommand(deps: HandlerDeps): Promise<boolean> {
  const { state, send, sessionStore } = deps;
  const session = sessionStore.getSession(state.authenticatedSessionId!);
  if (!session) { send({ type: "error", error: "Session not found" }); return true; }

  if (!state.reportSkillPrompt) {
    send({ type: "message_done", content: "The conversation summary feature is not available for this session." });
    return true;
  }
  if (!session.messages.some((m) => m.role === "user")) {
    send({ type: "message_done", content: "There are no messages to summarize yet." });
    return true;
  }
  try {
    const summary = await generateSummary(session.messages, state.reportSkillPrompt);
    if (!summary) {
      send({ type: "message_done", content: "Failed to generate summary. Please try again." });
      return true;
    }
    session.ended = true;
    send({ type: "message_done", content: summary });
    send({ type: "session_ended" });
  } catch (err) {
    console.error("[report] /summary command failed:", err);
    send({ type: "message_done", content: "Failed to generate summary. Please try again." });
  }
  return true;
}

async function handleMessage(content: string, deps: HandlerDeps) {
  const { state, send, sessionStore, queryQueue, connectionManager } = deps;
  const sessionId = state.authenticatedSessionId!;
  const session = sessionStore.getSession(sessionId);
  if (!session) { send({ type: "error", error: "Session not found" }); return; }

  if (session.ended) {
    send({ type: "error", error: "This conversation has ended. The summary has already been downloaded." });
    return;
  }

  if (content.trim() === "/summary") {
    await handleSummaryCommand(deps);
    return;
  }

  if (session.maxMessagesPerSession !== null) {
    const count = session.messages.filter(m => m.role === "user").length;
    if (count >= session.maxMessagesPerSession) {
      send({ type: "error", error: "Message limit reached for this session." });
      return;
    }
  }

  session.messages.push({ role: "user", content });
  const queryId = randomUUID();

  try {
    await queryQueue.enqueue(queryId, config.queryQueueTimeoutMs);
  } catch {
    send({ type: "error", error: "Server is busy. Please try again shortly." });
    return;
  }

  const abortController = new AbortController();
  sessionStore.setActiveQuery(sessionId, queryId, abortController);
  const previousSdkSessionId = session.sdkSessionId;

  try {
    let fullResponse = "";
    let responseSources: string[] | undefined;
    for await (const event of runQuery({
      userMessage: content, session,
      djangoUrl: config.djangoUrl, ownerToken: config.ownerToken,
      signal: abortController, publicOnly: state.isPublicOnly,
    })) {
      connectionManager.broadcast(sessionId, event);
      if (event.type === "message_done") {
        fullResponse = event.content;
        responseSources = event.sources;
      }
    }

    if (fullResponse) {
      const entry: { role: "assistant"; content: string; sources?: string[] } = { role: "assistant", content: fullResponse };
      if (responseSources?.length) entry.sources = responseSources;
      session.messages.push(entry);
    }

    if (fullResponse && !state.skipChatLog && state.authenticatedInviteCode) {
      logChat(config.djangoUrl, config.ownerToken, state.authenticatedInviteCode, content, fullResponse, sessionId, responseSources).catch(() => {});
    }

    if (!state.skipChatLog && state.authenticatedInviteCode && session.sdkSessionId && session.sdkSessionId !== previousSdkSessionId) {
      saveSession({
        djangoUrl: config.djangoUrl, ownerToken: config.ownerToken,
        sessionId, inviteCode: state.authenticatedInviteCode,
        sdkSessionId: session.sdkSessionId,
      }).catch(() => {});
    }
  } finally {
    sessionStore.clearActiveQuery(sessionId);
    queryQueue.release(queryId);
  }
}

async function handleGenerateReport(deps: HandlerDeps) {
  const { state, send, sessionStore } = deps;
  const session = sessionStore.getSession(state.authenticatedSessionId!);
  if (!session) { send({ type: "report_error", message: "Session not found" }); return; }
  if (session.ended) { send({ type: "report_error", message: "Summary has already been generated." }); return; }
  if (!state.reportSkillPrompt) { send({ type: "report_error", message: "Report generation is not available" }); return; }
  if (session.messages.length === 0) { send({ type: "report_error", message: "No messages to generate a report from" }); return; }

  send({ type: "report_generating" });
  try {
    const summary = await generateSummary(session.messages, state.reportSkillPrompt);
    if (!summary) { send({ type: "report_error", message: "Failed to generate summary" }); return; }
    session.ended = true;
    send({ type: "report_ready", summary });
    send({ type: "session_ended" });
  } catch (err) {
    console.error("[report] generation failed:", err);
    send({ type: "report_error", message: "Failed to generate report. Please try again." });
  }
}

export function handleConnection(
  ws: WebSocket,
  sessionStore: SessionStore,
  queryQueue: QueryQueue,
  connectionManager: ConnectionManager,
  req?: IncomingMessage,
) {
  const clientIp = getClientIp(req);
  console.log("[ws] new connection from", clientIp);

  const state: ConnectionState = {
    authenticatedSessionId: null,
    authenticatedInviteCode: null,
    reportSkillPrompt: null,
    skipChatLog: false,
    isPublicOnly: false,
  };

  function send(msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  const deps: HandlerDeps = { state, send, sessionStore, queryQueue, connectionManager };

  ws.on("message", async (raw) => {
    const msg = parseClientMessage(raw.toString());
    if (!msg) { send({ type: "error", error: "Invalid message format" }); return; }

    if (msg.type === "auth") {
      if (isRateLimited(clientIp)) {
        send({ type: "auth_error", error: "Too many attempts. Please try again later." });
        return;
      }
      const authMsg = msg as unknown as Record<string, unknown>;
      if (authMsg.owner_token) {
        await doOwnerPreview(authMsg, state, send, sessionStore, connectionManager, ws, clientIp);
      } else {
        await doAuth(authMsg.invite_code as string, authMsg.session_id as string | undefined, state, send, sessionStore, connectionManager, ws, clientIp);
      }
    } else if (msg.type === "message") {
      if (!state.authenticatedSessionId) { send({ type: "error", error: "Not authenticated" }); return; }
      await handleMessage(msg.content, deps);
    } else if (msg.type === "context") {
      if (!state.authenticatedSessionId) { send({ type: "error", error: "Not authenticated" }); return; }
      handleContext((msg as unknown as { content: string; author?: string }).content, (msg as unknown as { author?: string }).author, deps);
    } else if (msg.type === "cancel") {
      if (state.authenticatedSessionId) sessionStore.cancelActiveQuery(state.authenticatedSessionId);
    } else if (msg.type === "fetch_content") {
      if (!state.authenticatedSessionId) { send({ type: "error", error: "Not authenticated" }); return; }
      await handleFetchContent((msg as unknown as { path: string }).path, deps);
    } else if (msg.type === "generate_report") {
      if (!state.authenticatedSessionId) { send({ type: "error", error: "Not authenticated" }); return; }
      await handleGenerateReport(deps);
    }
  });

  ws.on("close", () => {
    if (state.authenticatedSessionId) connectionManager.removeConnection(state.authenticatedSessionId, ws);
  });

  ws.on("error", (err) => console.error("[ws] error", err.message));
}
