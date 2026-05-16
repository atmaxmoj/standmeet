/**
 * Mock AI control helpers.
 * Communicates with gateway's /test/mock HTTP endpoints.
 */

const GATEWAY_HTTP_URL = (process.env.GATEWAY_URL || "ws://gateway:8001").replace(/^ws/, "http");

export async function setMockResponse(response: string, options?: { delayMs?: number; sources?: string[]; simulateExpiredSession?: boolean }): Promise<void> {
  const body: Record<string, unknown> = { response };
  if (options?.delayMs !== undefined) body.delayMs = options.delayMs;
  if (options?.sources !== undefined) body.sources = options.sources;
  if (options?.simulateExpiredSession !== undefined) body.simulateExpiredSession = options.simulateExpiredSession;

  const res = await fetch(`${GATEWAY_HTTP_URL}/test/mock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`setMockResponse failed: ${res.status}`);
}

export async function resetMock(): Promise<void> {
  const res = await fetch(`${GATEWAY_HTTP_URL}/test/mock/reset`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`resetMock failed: ${res.status}`);
}

/** Evict all gateway sessions from memory, forcing DB restore on next reconnect. */
export async function evictAllSessions(): Promise<void> {
  const res = await fetch(`${GATEWAY_HTTP_URL}/test/evict-sessions`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`evictAllSessions failed: ${res.status}`);
}

/** Set a fake sdkSessionId on all in-memory sessions (simulates stale state). */
export async function setSdkSessionId(sdkSessionId = "fake-expired-id"): Promise<void> {
  const res = await fetch(`${GATEWAY_HTTP_URL}/test/set-sdk-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdk_session_id: sdkSessionId }),
  });
  if (!res.ok) throw new Error(`setSdkSessionId failed: ${res.status}`);
}
