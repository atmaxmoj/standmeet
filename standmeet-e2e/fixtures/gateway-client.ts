import WebSocket from "ws";

export interface AuthResult {
  success: boolean;
  sessionId?: string;
  label?: string;
  error?: string;
  capabilities?: { canGenerateReport?: boolean };
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Lightweight WebSocket client for testing the Gateway protocol.
 * Adapted from im-bridge's ws-client.ts for E2E test use.
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private pendingAuth: {
    resolve: (result: AuthResult) => void;
    reject: (err: Error) => void;
  } | null = null;
  private pendingMessage: {
    resolve: (response: string) => void;
    reject: (err: Error) => void;
    buffer: string;
  } | null = null;
  private greetingResolve: ((content: string) => void) | null = null;
  private waitingForGreeting = false;
  private _lastSources: string[] | undefined = undefined;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Sources from the most recent message_done (undefined if none). */
  get lastSources(): string[] | undefined {
    return this._lastSources;
  }

  connect(gatewayUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(gatewayUrl);

      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));

      this.ws.on("message", (raw) => {
        try {
          const msg: ServerMessage = JSON.parse(raw.toString());
          this.handleMessage(msg);
        } catch {
          // ignore parse errors
        }
      });

      this.ws.on("close", () => {
        this.ws = null;
      });
    });
  }

  authenticate(inviteCode: string, sessionId?: string): Promise<AuthResult> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      this.pendingAuth = { resolve, reject };
      this.waitingForGreeting = true;

      const authMsg: Record<string, unknown> = {
        type: "auth",
        invite_code: inviteCode,
      };
      if (sessionId) authMsg.session_id = sessionId;

      this.ws.send(JSON.stringify(authMsg));
    });
  }

  /** Wait for the greeting (first message_done after auth). */
  waitGreeting(timeout = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.greetingResolve = null;
        reject(new Error("Greeting timeout"));
      }, timeout);

      this.greetingResolve = (content: string) => {
        clearTimeout(timer);
        resolve(content);
      };
    });
  }

  sendMessage(content: string, timeout = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingMessage = null;
        reject(new Error("Message response timeout"));
      }, timeout);

      this.pendingMessage = {
        resolve: (response: string) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
        buffer: "",
      };
      this.ws.send(JSON.stringify({ type: "message", content }));
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "auth_ok":
        if (this.pendingAuth) {
          const auth = this.pendingAuth;
          this.pendingAuth = null;
          auth.resolve({
            success: true,
            sessionId: msg.session_id as string,
            label: msg.label as string,
            capabilities: msg.capabilities as { canGenerateReport?: boolean } | undefined,
          });
        }
        break;

      case "auth_error":
        if (this.pendingAuth) {
          const auth = this.pendingAuth;
          this.pendingAuth = null;
          this.waitingForGreeting = false;
          auth.resolve({
            success: false,
            error: msg.error as string,
          });
        }
        break;

      case "text_delta":
        if (this.pendingMessage) {
          this.pendingMessage.buffer += msg.text as string;
        }
        break;

      case "message_done": {
        const content = msg.content as string;
        this._lastSources = Array.isArray(msg.sources) ? msg.sources as string[] : undefined;

        if (this.waitingForGreeting) {
          this.waitingForGreeting = false;
          if (this.greetingResolve) {
            const cb = this.greetingResolve;
            this.greetingResolve = null;
            cb(content);
          }
          return;
        }

        if (this.pendingMessage) {
          const pending = this.pendingMessage;
          this.pendingMessage = null;
          pending.resolve(content);
        }
        break;
      }

      case "error":
        if (this.pendingMessage) {
          const pending = this.pendingMessage;
          this.pendingMessage = null;
          pending.reject(new Error(msg.error as string));
        }
        break;
    }
  }
}
