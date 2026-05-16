import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GatewaySession, ChatHistoryEntry } from "../session/types.js";
import { buildMcpServer } from "./mcp-tools.js";
import { getMockConfig } from "./mock-state.js";

type GatewayEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; tool: string; status: "start" | "done"; args?: Record<string, unknown> }
  | { type: "message_done"; content: string; sources?: string[] }
  | { type: "error"; error: string };

async function* runMockQuery(params: {
  userMessage: string;
}): AsyncGenerator<GatewayEvent> {
  const mock = getMockConfig();
  console.log("[mock-query] responding with mock", JSON.stringify({ response: mock.response, delayMs: mock.delayMs, sources: mock.sources }));
  await new Promise((r) => setTimeout(r, mock.delayMs));
  yield { type: "text_delta", text: mock.response };
  yield { type: "message_done", content: mock.response, sources: mock.sources?.length > 0 ? mock.sources : undefined };
}

/** Build a conversation context string from chat history for prompt injection. */
function buildHistoryContext(messages: ChatHistoryEntry[]): string {
  if (!messages.length) return "";
  const lines = messages.map((m) =>
    m.role === "user" ? `Visitor: ${m.content}` : `You: ${m.content}`
  );
  return (
    "[Previous conversation in this session — use this as context]\n" +
    lines.join("\n\n") +
    "\n[End of previous conversation]\n\n"
  );
}

/** Check if a result message indicates an expired SDK session. */
function isExpiredSessionError(message: SDKMessage): boolean {
  const r = message as any;
  return (
    r.type === "result" &&
    r.is_error &&
    r.errors?.some((e: string) => e.includes("No conversation found"))
  );
}

/** Build MCP server map for a query attempt. */
function buildMcpServers(
  session: GatewaySession,
  djangoUrl: string,
  ownerToken: string,
  publicOnly?: boolean,
): Record<string, unknown> {
  const mcpServer = buildMcpServer(session.permissions, djangoUrl, ownerToken, publicOnly, session.readSources);
  const mcpServers: Record<string, unknown> = { standmeet: mcpServer };
  for (const custom of session.customMcpServers) {
    mcpServers[custom.name] = custom.config;
  }
  for (const skillServer of session.skillToolServers) {
    mcpServers[skillServer.name] = skillServer.server;
  }
  return mcpServers;
}

/** Build the effective prompt, prepending history context when not resuming. */
function buildEffectivePrompt(
  userMessage: string,
  session: GatewaySession,
): string {
  if (!session.sdkSessionId && session.messages.length > 0) {
    const historyContext = buildHistoryContext(session.messages);
    if (historyContext) {
      return historyContext + "Visitor: " + userMessage;
    }
  }
  return userMessage;
}

/** Handle a "result" type SDK message. Yields events and returns control flags. */
function* handleResultMessage(
  message: SDKMessage,
  session: GatewaySession,
  fullText: string,
  lastTextLength: number,
  attempt: number,
): Generator<GatewayEvent | { __control: "retry" } | { __control: "return" }> {
  const r = message as any;

  // Check for expired SDK session — retry without resume
  if (attempt === 0 && session.sdkSessionId && isExpiredSessionError(message)) {
    console.log("[query] SDK session expired, retrying with history context");
    session.sdkSessionId = null;
    yield { __control: "retry" };
    return;
  }

  console.log("[query] result subtype:", r.subtype, "is_error:", r.is_error, "num_turns:", r.num_turns);
  if (r.errors?.length) {
    console.error("[query] result errors:", JSON.stringify(r.errors));
  }
  // Save SDK session ID for future resume
  if (r.session_id) {
    session.sdkSessionId = r.session_id;
  }
  if ("result" in message && (message as any).result) {
    fullText = (message as any).result;
    if (fullText.length > lastTextLength) {
      yield { type: "text_delta", text: fullText.slice(lastTextLength) };
    }
  }
  if (!fullText && r.is_error) {
    const errorDetail = r.errors?.join("; ") || r.subtype || "Unknown error";
    yield { type: "error", error: errorDetail };
    yield { __control: "return" };
    return;
  }
  yield {
    type: "message_done",
    content: fullText,
    sources: session.readSources.length > 0 ? [...session.readSources] : undefined,
  };
  yield { __control: "return" };
}

/** Handle an "assistant" type SDK message. Yields text_delta and tool_use events. */
function* handleAssistantMessage(
  message: SDKMessage,
  lastTextLength: number,
): Generator<GatewayEvent | { __update: { lastTextLength: number; fullText: string } }> {
  const betaMsg = (message as any).message;
  if (!betaMsg?.content) return;
  for (const block of betaMsg.content) {
    if (block.type === "text" && block.text) {
      const newText = block.text.slice(lastTextLength);
      if (newText) {
        yield { __update: { lastTextLength: block.text.length, fullText: block.text } };
        yield { type: "text_delta", text: newText };
      }
    } else if (block.type === "tool_use") {
      yield { type: "tool_use", tool: block.name, status: "start", args: block.input as Record<string, unknown> };
    }
  }
}

export async function* runQuery(params: {
  userMessage: string;
  session: GatewaySession;
  djangoUrl: string;
  ownerToken: string;
  signal: AbortController;
  publicOnly?: boolean;
}): AsyncGenerator<GatewayEvent> {
  const { userMessage, session, djangoUrl, ownerToken, signal, publicOnly } = params;

  const mock = getMockConfig();

  console.log("[query] start", JSON.stringify({ userMessage }));

  // Try up to 2 attempts: first with resume (if available), then without
  for (let attempt = 0; attempt < 2; attempt++) {
    // Mock mode: simulate expired session on first attempt if configured
    if (mock.enabled) {
      if (attempt === 0 && mock.simulateExpiredSession && session.sdkSessionId) {
        console.log("[mock-query] simulating expired SDK session, retrying with history context");
        session.sdkSessionId = null;
        continue; // retry without resume
      }
      yield* runMockQuery({ userMessage });
      return;
    }

    let fullText = "";
    let lastTextLength = 0;

    const mcpServers = buildMcpServers(session, djangoUrl, ownerToken, publicOnly);
    const effectivePrompt = buildEffectivePrompt(userMessage, session);

    const queryOptions: Record<string, unknown> = {
      systemPrompt: session.systemPrompt,
      mcpServers,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
    };
    if (session.sdkSessionId) {
      queryOptions.resume = session.sdkSessionId;
    }

    try {
      let retryWithoutResume = false;

      for await (const message of query({
        prompt: effectivePrompt,
        options: queryOptions as any,
      })) {
        if (signal.signal.aborted) return;

        if (message.type === "result") {
          for (const ev of handleResultMessage(message, session, fullText, lastTextLength, attempt)) {
            if ("__control" in ev) {
              if (ev.__control === "retry") { retryWithoutResume = true; break; }
              if (ev.__control === "return") return;
            } else {
              yield ev;
            }
          }
          if (retryWithoutResume) break;
        }

        // Handle assistant messages (BetaMessage inside)
        if (message.type === "assistant") {
          for (const ev of handleAssistantMessage(message, lastTextLength)) {
            if ("__update" in ev) {
              lastTextLength = ev.__update.lastTextLength;
              fullText = ev.__update.fullText;
            } else {
              yield ev;
            }
          }
        }
      }

      if (retryWithoutResume) {
        continue; // go to next attempt without resume
      }

      // If we exit without a result message, emit what we have
      if (fullText) {
        yield {
          type: "message_done",
          content: fullText,
          sources: session.readSources.length > 0 ? [...session.readSources] : undefined,
        };
      }
      return;
    } catch (err) {
      if (signal.signal.aborted) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[query error]", errorMsg);
      yield { type: "error", error: errorMsg };
      return;
    }
  }
}
