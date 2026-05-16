import { randomUUID } from "node:crypto";
import type { ChatHistoryEntry, CustomMcpServer, GatewaySession, PathPermission, SkillToolServer } from "./types.js";

type SessionStoreOptions = {
  maxSessions?: number;
  idleTtlMs?: number;
  now?: () => number;
};

export type CreateSessionParams = {
  inviteCode: string;
  systemPrompt: string;
  permissions: PathPermission[];
  maxMessagesPerSession?: number | null;
  customMcpServers?: CustomMcpServer[];
  skillToolServers?: SkillToolServer[];
};

export type RestoreSessionParams = CreateSessionParams & {
  sessionId: string;
  sdkSessionId: string | null;
  messages: ChatHistoryEntry[];
};

export type SessionStore = {
  createSession(params: CreateSessionParams): GatewaySession;
  restoreSession(params: RestoreSessionParams): GatewaySession;
  getSession(sessionId: string): GatewaySession | undefined;
  /** @deprecated Use getSession(sessionId) — kept for connection-manager compat */
  getSessionByInviteCode(inviteCode: string): GatewaySession | undefined;
  removeSession(sessionId: string): boolean;
  touchSession(sessionId: string): void;
  setActiveQuery(sessionId: string, queryId: string, abortController: AbortController): void;
  clearActiveQuery(sessionId: string): void;
  cancelActiveQuery(sessionId: string): boolean;
  sessionCount(): number;
  activeQueryCount(): number;
  clearAllForTest(): void;
  setAllSdkSessionIds(sdkSessionId: string): number;
};

const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_IDLE_TTL_MS = 4 * 60 * 60 * 1000; // 4h

function buildSession(params: CreateSessionParams, sessionId: string, timestamp: number): GatewaySession {
  return {
    sessionId,
    sdkSessionId: null,
    inviteCode: params.inviteCode,
    systemPrompt: params.systemPrompt,
    permissions: params.permissions,
    customMcpServers: params.customMcpServers ?? [],
    skillToolServers: params.skillToolServers ?? [],
    createdAt: timestamp,
    lastTouchedAt: timestamp,
    maxMessagesPerSession: params.maxMessagesPerSession ?? null,
    abortController: null,
    activeQueryId: null,
    wsConnections: new Set(),
    messages: [],
    readSources: [],
    ended: false,
  };
}

function extractReadSources(messages: ChatHistoryEntry[]): string[] {
  const readSources: string[] = [];
  for (const msg of messages) {
    if (msg.sources) {
      for (const src of msg.sources) {
        if (!readSources.includes(src)) readSources.push(src);
      }
    }
  }
  return readSources;
}

function reapIdleSessions(sessions: Map<string, GatewaySession>, cutoff: number) {
  for (const [id, session] of sessions.entries()) {
    if (session.activeQueryId || session.abortController) continue;
    if (session.lastTouchedAt > cutoff) continue;
    sessions.delete(id);
  }
}

function evictOldestIdle(sessions: Map<string, GatewaySession>): boolean {
  let oldestId: string | null = null;
  let oldestTime = Infinity;
  for (const [id, session] of sessions.entries()) {
    if (session.activeQueryId || session.abortController) continue;
    if (session.lastTouchedAt < oldestTime) {
      oldestTime = session.lastTouchedAt;
      oldestId = id;
    }
  }
  if (!oldestId) return false;
  const session = sessions.get(oldestId);
  session?.abortController?.abort();
  sessions.delete(oldestId);
  return true;
}

function ensureCapacity(sessions: Map<string, GatewaySession>, maxSessions: number, now: () => number, idleTtlMs: number) {
  reapIdleSessions(sessions, now() - idleTtlMs);
  if (sessions.size >= maxSessions && !evictOldestIdle(sessions)) {
    throw new Error(`Session limit reached (max ${maxSessions}). Try again later.`);
  }
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS);
  const idleTtlMs = Math.max(1000, options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS);
  const now = options.now ?? Date.now;
  const sessions = new Map<string, GatewaySession>();

  function touch(session: GatewaySession) {
    session.lastTouchedAt = now();
  }

  return {
    createSession(params) {
      ensureCapacity(sessions, maxSessions, now, idleTtlMs);
      const session = buildSession(params, randomUUID(), now());
      sessions.set(session.sessionId, session);
      return session;
    },

    restoreSession(params) {
      ensureCapacity(sessions, maxSessions, now, idleTtlMs);
      const session = buildSession(params, params.sessionId, now());
      session.sdkSessionId = params.sdkSessionId ?? null;
      session.messages = [...params.messages];
      session.readSources = extractReadSources(params.messages);
      sessions.set(params.sessionId, session);
      return session;
    },

    getSession(sessionId) {
      const session = sessions.get(sessionId);
      if (session) touch(session);
      return session;
    },

    getSessionByInviteCode(inviteCode) {
      for (const session of sessions.values()) {
        if (session.inviteCode === inviteCode) {
          touch(session);
          return session;
        }
      }
      return undefined;
    },

    removeSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return false;
      session.abortController?.abort();
      sessions.delete(sessionId);
      return true;
    },

    touchSession(sessionId) {
      const session = sessions.get(sessionId);
      if (session) touch(session);
    },

    setActiveQuery(sessionId, queryId, abortController) {
      const session = sessions.get(sessionId);
      if (!session) return;
      session.activeQueryId = queryId;
      session.abortController = abortController;
      touch(session);
    },

    clearActiveQuery(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return;
      session.activeQueryId = null;
      session.abortController = null;
      touch(session);
    },

    cancelActiveQuery(sessionId) {
      const session = sessions.get(sessionId);
      if (!session?.abortController) return false;
      session.abortController.abort();
      session.abortController = null;
      session.activeQueryId = null;
      touch(session);
      return true;
    },

    sessionCount() {
      return sessions.size;
    },

    activeQueryCount() {
      let count = 0;
      for (const session of sessions.values()) {
        if (session.activeQueryId) count++;
      }
      return count;
    },

    clearAllForTest() {
      for (const session of sessions.values()) {
        session.abortController?.abort();
      }
      sessions.clear();
    },

    setAllSdkSessionIds(sdkSessionId: string) {
      let count = 0;
      for (const session of sessions.values()) {
        session.sdkSessionId = sdkSessionId;
        count++;
      }
      return count;
    },
  };
}
