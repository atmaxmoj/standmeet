import type { ChatHistoryEntry } from "../session/types.js";

type SaveSessionParams = {
  djangoUrl: string;
  ownerToken: string;
  sessionId: string;
  inviteCode: string;
  sdkSessionId: string;
};

export async function saveSession(params: SaveSessionParams): Promise<void> {
  const { djangoUrl, ownerToken, sessionId, inviteCode, sdkSessionId } = params;
  const res = await fetch(`${djangoUrl}/api/internal/session/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({
      session_id: sessionId,
      invite_code: inviteCode,
      sdk_session_id: sdkSessionId,
    }),
  });

  if (!res.ok) {
    console.error(`[session-persistence] save failed (${res.status}): ${await res.text()}`);
  }
}

type RestoredSession = {
  inviteCode: string;
  sdkSessionId: string;
  history: ChatHistoryEntry[];
};

export async function restoreSession(
  djangoUrl: string,
  ownerToken: string,
  sessionId: string,
): Promise<RestoredSession | null> {
  const res = await fetch(`${djangoUrl}/api/internal/session/${sessionId}/`, {
    headers: {
      Authorization: `Bearer ${ownerToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    console.error(`[session-persistence] restore failed (${res.status}): ${await res.text()}`);
    return null;
  }

  const data = await res.json();
  return {
    inviteCode: data.invite_code,
    sdkSessionId: data.sdk_session_id,
    history: data.history,
  };
}
