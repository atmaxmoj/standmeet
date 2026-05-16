import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { createSessionStore } from "./session/store.js";
import { createQueryQueue } from "./session/query-queue.js";
import { createConnectionManager } from "./ws/connection-manager.js";
import { handleConnection } from "./ws/handler.js";
import { config } from "./config.js";
import { resetRateLimiter } from "./ws/rate-limiter.js";
import { enableMock, setMockConfig, resetMockConfig, getMockConfig } from "./runtime/mock-state.js";
import { generateSummary } from "./runtime/report.js";

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function handleTestRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  sessionStore: ReturnType<typeof createSessionStore>,
): Promise<boolean> {
  if (req.method === "POST" && req.url === "/test/reset-rate-limiter") {
    resetRateLimiter();
    jsonResponse(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && req.url === "/test/mock" && getMockConfig().enabled) {
    const body = await readJsonBody(req);
    setMockConfig({
      response: typeof body.response === "string" ? body.response : undefined,
      delayMs: typeof body.delayMs === "number" ? body.delayMs : undefined,
      sources: Array.isArray(body.sources) ? body.sources as string[] : [],
      simulateExpiredSession: typeof body.simulateExpiredSession === "boolean" ? body.simulateExpiredSession : false,
    });
    jsonResponse(res, 200, { ok: true, config: getMockConfig() });
    return true;
  }

  if (req.method === "POST" && req.url === "/test/mock/reset" && getMockConfig().enabled) {
    resetMockConfig();
    jsonResponse(res, 200, { ok: true, config: getMockConfig() });
    return true;
  }

  if (req.method === "POST" && req.url === "/test/set-sdk-session") {
    const body = await readJsonBody(req);
    const sdkSessionId = typeof body.sdk_session_id === "string" ? body.sdk_session_id : "fake-expired-id";
    const count = sessionStore.setAllSdkSessionIds(sdkSessionId);
    jsonResponse(res, 200, { ok: true, updated: count, sdk_session_id: sdkSessionId });
    return true;
  }

  if (req.method === "POST" && req.url === "/test/evict-sessions") {
    const count = sessionStore.sessionCount();
    sessionStore.clearAllForTest();
    jsonResponse(res, 200, { ok: true, evicted: count });
    return true;
  }

  if (req.method === "GET" && req.url === "/test/fixture/skill-md") {
    const skillMd = [
      "---",
      "name: E2E URL Import Test Skill",
      "description: A skill imported via URL for testing",
      "version: 1.0.0",
      "---",
      "",
      "You are a test skill imported from a URL. Always mention MANGO in your responses.",
      "",
    ].join("\n");
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(skillMd);
    return true;
  }

  return false;
}

async function handleGenerateReport(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "POST" || req.url !== "/api/generate-report") return false;

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${config.ownerToken}`) {
    jsonResponse(res, 401, { error: "Unauthorized" });
    return true;
  }
  const body = await readJsonBody(req);
  const messages = body.messages as Array<{ role: string; content: string }>;
  const prompt = body.prompt as string;
  if (!Array.isArray(messages) || !messages.length || !prompt) {
    jsonResponse(res, 400, { error: "messages and prompt are required" });
    return true;
  }
  try {
    const chatMessages = messages.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: String(m.content),
    }));
    const summary = await generateSummary(chatMessages, prompt);
    jsonResponse(res, 200, { summary });
  } catch (err) {
    console.error("[report] HTTP generate-report failed:", err);
    jsonResponse(res, 500, { error: "Failed to generate report" });
  }
  return true;
}

export function startServer(port?: number) {
  const listenPort = port ?? config.port;

  if (config.mockAi) {
    enableMock();
    console.log("[mock] AI mock mode enabled");
  }

  const sessionStore = createSessionStore({
    maxSessions: config.maxSessions,
    idleTtlMs: config.sessionIdleTtlMs,
  });

  const queryQueue = createQueryQueue(config.maxConcurrentQueries);
  const connectionManager = createConnectionManager(sessionStore);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (await handleTestRoutes(req, res, sessionStore)) return;
    if (await handleGenerateReport(req, res)) return;

    jsonResponse(res, 200, {
      status: "ok",
      sessions: sessionStore.sessionCount(),
      activeQueries: sessionStore.activeQueryCount(),
      pendingQueries: queryQueue.pending(),
    });
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws, req) => {
    handleConnection(ws, sessionStore, queryQueue, connectionManager, req);
  });

  httpServer.listen(listenPort, () => {
    console.log(`StandMeet Gateway listening on port ${listenPort}`);
  });

  return { httpServer, wss, sessionStore, queryQueue, connectionManager };
}
