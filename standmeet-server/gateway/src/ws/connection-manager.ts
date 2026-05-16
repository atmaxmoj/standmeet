import type WebSocket from "ws";
import type { ServerMessage } from "./protocol.js";
import type { SessionStore } from "../session/store.js";

export type ConnectionManager = {
  addConnection(sessionId: string, ws: WebSocket): void;
  removeConnection(sessionId: string, ws: WebSocket): void;
  broadcast(sessionId: string, message: ServerMessage): void;
  getConnectionCount(sessionId: string): number;
};

export function createConnectionManager(sessionStore: SessionStore): ConnectionManager {
  return {
    addConnection(sessionId, ws) {
      const session = sessionStore.getSession(sessionId);
      if (session) {
        session.wsConnections.add(ws);
      }
    },

    removeConnection(sessionId, ws) {
      const session = sessionStore.getSession(sessionId);
      if (session) {
        session.wsConnections.delete(ws);
      }
    },

    broadcast(sessionId, message) {
      const session = sessionStore.getSession(sessionId);
      if (!session) return;
      const data = JSON.stringify(message);
      for (const ws of session.wsConnections) {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      }
    },

    getConnectionCount(sessionId) {
      const session = sessionStore.getSession(sessionId);
      return session?.wsConnections.size ?? 0;
    },
  };
}
