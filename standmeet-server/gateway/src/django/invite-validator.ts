import type { SessionInitData } from "../session/types.js";

export async function validateInvite(
  djangoUrl: string,
  ownerToken: string,
  inviteCode: string,
  options?: { preview?: boolean },
): Promise<SessionInitData> {
  const body: Record<string, unknown> = { invite_code: inviteCode };
  if (options?.preview) {
    body.preview = true;
  }
  const res = await fetch(`${djangoUrl}/api/internal/session-init/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Invite validation failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function validateOwnerToken(
  djangoUrl: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${djangoUrl}/api/status/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Owner token validation failed (${res.status})`);
  }
}

export async function fetchSettings(
  djangoUrl: string,
  token: string,
): Promise<{ ai_system_prompt: string }> {
  const res = await fetch(`${djangoUrl}/api/settings/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch settings (${res.status})`);
  }
  return res.json();
}
