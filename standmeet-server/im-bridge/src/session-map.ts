import type { GatewayClient } from "./gateway/ws-client.js";

interface SessionEntry {
  client: GatewayClient;
  sessionId: string;
  inviteCode: string;
}

/**
 * Maps IM chats to Gateway sessions.
 * Key format: `${platform}:${chatId}:${inviteCode}`
 *
 * In DMs, chatId = userId (behavior unchanged).
 * In group chats, chatId = groupId/channelId (all members share one session).
 */
const sessions = new Map<string, SessionEntry>();

function makeKey(platform: string, chatId: string, inviteCode: string): string {
  return `${platform}:${chatId}:${inviteCode}`;
}

export function getSession(platform: string, chatId: string, inviteCode: string): SessionEntry | undefined {
  return sessions.get(makeKey(platform, chatId, inviteCode));
}

export function setSession(platform: string, chatId: string, inviteCode: string, entry: SessionEntry): void {
  sessions.set(makeKey(platform, chatId, inviteCode), entry);
}

function removeSession(platform: string, chatId: string, inviteCode: string): void {
  sessions.delete(makeKey(platform, chatId, inviteCode));
}

/**
 * Get or detect invite code for a chat.
 * Returns undefined if no active session exists for this chat on this platform.
 */
export function findActiveSession(platform: string, chatId: string): SessionEntry | undefined {
  for (const [key, entry] of sessions) {
    if (key.startsWith(`${platform}:${chatId}:`)) {
      return entry;
    }
  }
  return undefined;
}
