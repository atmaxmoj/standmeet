import WebSocket from "ws";

interface AuthResult {
  success: boolean;
  sessionId?: string;
  label?: string;
  error?: string;
  greeting?: string;
}

interface MessageResult {
  content: string;
  sources?: string[];
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * WebSocket client that connects to the Gateway using the same protocol
 * as the web frontend. Collects streaming text_delta events and returns
 * the full response on message_done.
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private pendingAuth: {
    resolve: (result: AuthResult) => void;
    reject: (err: Error) => void;
  } | null = null;
  private pendingMessage: {
    resolve: (response: MessageResult) => void;
    reject: (err: Error) => void;
    buffer: string;
  } | null = null;
  private greetingCallback: ((content: string) => void) | null = null;
  private waitingForGreeting = false;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
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

  sendMessage(content: string): Promise<MessageResult> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      this.pendingMessage = { resolve, reject, buffer: "" };
      this.ws.send(JSON.stringify({ type: "message", content }));
    });
  }

  /**
   * Send a context message (logged to chat history, no AI response).
   * Used for group chat messages that don't @mention the bot.
   */
  sendContext(content: string, author?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { type: "context", content };
    if (author) msg.author = author;
    this.ws.send(JSON.stringify(msg));
  }

  onGreeting(cb: (content: string) => void): void {
    this.greetingCallback = cb;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "auth_ok":
        this.sessionId = msg.session_id as string;
        if (this.pendingAuth) {
          const auth = this.pendingAuth;
          this.pendingAuth = null;
          auth.resolve({
            success: true,
            sessionId: msg.session_id as string,
            label: msg.label as string,
          });
        }
        break;

      case "auth_error":
        if (this.pendingAuth) {
          const auth = this.pendingAuth;
          this.pendingAuth = null;
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
        const sources = Array.isArray(msg.sources) ? msg.sources as string[] : undefined;

        // If we're waiting for greeting (first message_done after auth)
        if (this.waitingForGreeting) {
          this.waitingForGreeting = false;
          if (this.greetingCallback) {
            this.greetingCallback(content);
          }
          return;
        }

        // Otherwise it's a response to a user message
        if (this.pendingMessage) {
          const pending = this.pendingMessage;
          this.pendingMessage = null;
          pending.resolve({ content, sources });
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
