const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getMcpUrl(): string {
  return `${API_URL}/mcp/`;
}

export function getMcpConfig(): object {
  return {
    mcpServers: {
      standmeet: {
        url: getMcpUrl(),
      },
    },
  };
}

export function getGatewayUrl(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:8001";
}

export function validateInviteCode(code: string): Promise<{ ok: true; label: string; sessionId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      resolve({ ok: false, error: "Connection timed out. Please try again." });
    }, 10_000);

    const ws = new WebSocket(getGatewayUrl());

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", invite_code: code }));
    };

    ws.onmessage = (event) => {
      if (settled) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "auth_ok") {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve({ ok: true, label: msg.label, sessionId: msg.session_id });
        } else if (msg.type === "auth_error") {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve({ ok: false, error: msg.error });
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, error: "Could not connect to server. Please try again." });
    };

    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, error: "Connection closed unexpectedly." });
    };
  });
}
