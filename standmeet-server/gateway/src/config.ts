export const config = {
  djangoUrl: process.env.DJANGO_URL || "http://localhost:8000",
  ownerToken: process.env.OWNER_TOKEN || "",
  port: parseInt(process.env.GATEWAY_PORT || "8001", 10),
  maxSessions: parseInt(process.env.MAX_SESSIONS || "50", 10),
  maxConcurrentQueries: parseInt(process.env.MAX_CONCURRENT_QUERIES || "3", 10),
  sessionIdleTtlMs: parseInt(process.env.SESSION_IDLE_TTL_MS || "14400000", 10), // 4h
  queryQueueTimeoutMs: parseInt(process.env.QUERY_QUEUE_TIMEOUT_MS || "30000", 10), // 30s
  mockAi: process.env.MOCK_AI === "true",
};
