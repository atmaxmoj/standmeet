import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { SessionStore } from "../session/store.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { ServerMessage } from "./protocol.js";
import { validateInvite, validateOwnerToken, fetchSettings } from "../django/invite-validator.js";
import { saveSession, restoreSession as restoreSessionFromDb } from "../django/session-persistence.js";
import { logChat } from "../django/chat-logger.js";
import { config } from "../config.js";
import { recordAuthFailure } from "./rate-limiter.js";
import { buildSystemPrompt, getReportSkillPrompt, buildSkillToolServers } from "./helpers.js";
import { buildPageToolServer } from "../runtime/page-tools.js";

export type ConnectionState = {
  authenticatedSessionId: string | null;
  authenticatedInviteCode: string | null;
  reportSkillPrompt: string | null;
  skipChatLog: boolean;
  isPublicOnly: boolean;
};

type SendFn = (msg: ServerMessage) => void;

function buildAuthOk(
  label: string,
  sessionId: string,
  reportSkillPrompt: string | null,
  messageLimit: number | null,
  messageCount: number,
  history?: unknown[],
  sessionEnded?: boolean,
  pageId?: string | null,
): ServerMessage {
  return {
    type: "auth_ok",
    label,
    session_id: sessionId,
    page_id: pageId || undefined,
    history: history?.length ? history : undefined,
    capabilities: { canGenerateReport: !!reportSkillPrompt },
    messageLimit,
    messageCount,
    sessionEnded: sessionEnded || undefined,
  } as ServerMessage;
}

export async function handleOwnerPreview(
  msg: Record<string, unknown>,
  state: ConnectionState,
  send: SendFn,
  sessionStore: SessionStore,
  connectionManager: ConnectionManager,
  ws: WebSocket,
  clientIp: string,
) {
  try {
    const ownerToken = msg.owner_token as string;
    await validateOwnerToken(config.djangoUrl, ownerToken);
    const previewMode = msg.preview_mode as string;

    if (previewMode === "invitation") {
      const inviteCode = msg.invite_code as string;
      if (!inviteCode) {
        send({ type: "auth_error", error: "invite_code required for invitation preview" });
        recordAuthFailure(clientIp);
        return;
      }
      const data = await validateInvite(config.djangoUrl, config.ownerToken, inviteCode, { preview: true });
      if (!data.invite.is_valid) {
        recordAuthFailure(clientIp);
        send({ type: "auth_error", error: "Invalid or expired invite code" });
        return;
      }
      state.reportSkillPrompt = getReportSkillPrompt(data);
      const session = sessionStore.createSession({
        inviteCode: `__preview_invite_${inviteCode}_${randomUUID()}`,
        systemPrompt: buildSystemPrompt(data),
        permissions: data.role?.permissions ?? [],
        maxMessagesPerSession: data.invite.max_messages_per_session,
        customMcpServers: data.mcp_servers ?? [],
        skillToolServers: buildSkillToolServers(data),
      });
      state.authenticatedSessionId = session.sessionId;
      state.authenticatedInviteCode = session.inviteCode;
      state.skipChatLog = true;
      connectionManager.addConnection(session.sessionId, ws);
      send(buildAuthOk(data.invite.label, session.sessionId, state.reportSkillPrompt, data.invite.max_messages_per_session, 0));

      // Send greeting as the first assistant message if configured
      const greeting = data.invite.greeting;
      if (greeting) {
        session.messages.push({ role: "assistant", content: greeting });
        send({ type: "message_done", content: greeting } as ServerMessage);
      }
    } else if (previewMode === "page_generate") {
      const pageId = msg.page_id as string;
      const roleId = (msg.role_id as string) || null;
      const packageConstraints = (msg.package_constraints as string) || "";
      if (!pageId) {
        send({ type: "auth_error", error: "page_id required for page_generate mode" });
        recordAuthFailure(clientIp);
        return;
      }

      const systemPrompt = buildPageGeneratePrompt(packageConstraints);
      const pageToolServer = buildPageToolServer(config.djangoUrl, config.ownerToken, pageId, roleId);

      const session = sessionStore.createSession({
        inviteCode: `__page_generate_${pageId}_${randomUUID()}`,
        systemPrompt,
        permissions: [],
        customMcpServers: [],
        skillToolServers: [{ name: "page-builder", server: pageToolServer }],
      });
      state.authenticatedSessionId = session.sessionId;
      state.authenticatedInviteCode = session.inviteCode;
      state.skipChatLog = true;
      connectionManager.addConnection(session.sessionId, ws);
      send({ type: "auth_ok", label: "Page Generator", session_id: session.sessionId, capabilities: { canGenerateReport: false } });
    } else if (previewMode === "public") {
      const settings = await fetchSettings(config.djangoUrl, ownerToken);
      const systemPrompt =
        settings.ai_system_prompt ||
        "You are a helpful assistant representing the owner of this StandMeet profile. " +
          "Use the available tools to find information about the owner and answer questions.";
      const session = sessionStore.createSession({ inviteCode: `__preview_public_${randomUUID()}`, systemPrompt, permissions: [] });
      state.authenticatedSessionId = session.sessionId;
      state.authenticatedInviteCode = session.inviteCode;
      state.isPublicOnly = true;
      state.skipChatLog = true;
      connectionManager.addConnection(session.sessionId, ws);
      send({ type: "auth_ok", label: "Public View Preview", session_id: session.sessionId, capabilities: { canGenerateReport: false } });
    } else {
      send({ type: "auth_error", error: `Unknown preview_mode: ${previewMode}` });
      recordAuthFailure(clientIp);
    }
  } catch (err) {
    recordAuthFailure(clientIp);
    send({ type: "auth_error", error: err instanceof Error ? err.message : "Owner authentication failed" });
  }
}

export async function handleAuth(
  inviteCode: string,
  sessionId: string | undefined,
  state: ConnectionState,
  send: SendFn,
  sessionStore: SessionStore,
  connectionManager: ConnectionManager,
  ws: WebSocket,
  clientIp: string,
) {
  try {
    console.log("[handleAuth]", JSON.stringify({ inviteCode, sessionId: sessionId ?? null }));

    if (sessionId) {
      const resumed = await tryResumeSession(inviteCode, sessionId, state, send, sessionStore, connectionManager, ws, clientIp);
      if (resumed) return;
    }

    const data = await validateInvite(config.djangoUrl, config.ownerToken, inviteCode);
    if (!data.invite.is_valid) {
      recordAuthFailure(clientIp);
      send({ type: "auth_error", error: "Invalid or expired invite code" });
      return;
    }

    state.reportSkillPrompt = getReportSkillPrompt(data);
    const limit = data.invite.max_messages_per_session;

    // Join existing session for this invite code (multi-tab support)
    const existingByCode = sessionStore.getSessionByInviteCode(inviteCode);
    if (existingByCode) {
      state.authenticatedSessionId = existingByCode.sessionId;
      state.authenticatedInviteCode = inviteCode;
      connectionManager.addConnection(existingByCode.sessionId, ws);
      const count = existingByCode.messages.filter(m => m.role === "user").length;
      send(buildAuthOk(data.invite.label, existingByCode.sessionId, state.reportSkillPrompt, limit, count, existingByCode.messages));
      return;
    }

    // Create a new session
    const session = sessionStore.createSession({
      inviteCode,
      systemPrompt: buildSystemPrompt(data),
      permissions: data.role?.permissions ?? [],
      maxMessagesPerSession: limit,
      customMcpServers: data.mcp_servers ?? [],
      skillToolServers: buildSkillToolServers(data),
    });

    state.authenticatedSessionId = session.sessionId;
    state.authenticatedInviteCode = inviteCode;
    connectionManager.addConnection(session.sessionId, ws);
    send(buildAuthOk(data.invite.label, session.sessionId, state.reportSkillPrompt, limit, 0, undefined, undefined, data.invite.page_id));

    // Send greeting as the first assistant message if configured
    const greeting = data.invite.greeting;
    if (greeting) {
      session.messages.push({ role: "assistant", content: greeting });
      send({ type: "message_done", content: greeting } as ServerMessage);
      logChat(config.djangoUrl, config.ownerToken, inviteCode, "", greeting, session.sessionId)
        .catch((err) => console.error("[handleAuth] greeting logChat failed:", err));
    }

    console.log("[handleAuth] saving new session to DB:", session.sessionId);
    saveSession({
      djangoUrl: config.djangoUrl,
      ownerToken: config.ownerToken,
      sessionId: session.sessionId,
      inviteCode,
      sdkSessionId: "",
    }).catch((err) => console.error("[handleAuth] saveSession failed:", err));
  } catch (err) {
    recordAuthFailure(clientIp);
    send({ type: "auth_error", error: err instanceof Error ? err.message : "Authentication failed" });
  }
}

async function tryResumeSession(
  inviteCode: string,
  sessionId: string,
  state: ConnectionState,
  send: SendFn,
  sessionStore: SessionStore,
  connectionManager: ConnectionManager,
  ws: WebSocket,
  clientIp: string,
): Promise<boolean> {
  // Try memory first
  const existing = sessionStore.getSession(sessionId);
  console.log("[handleAuth] memory lookup:", existing ? "HIT" : "MISS");
  if (existing && existing.inviteCode === inviteCode) {
    const data = await validateInvite(config.djangoUrl, config.ownerToken, inviteCode, { preview: true });
    state.reportSkillPrompt = getReportSkillPrompt(data);
    state.authenticatedSessionId = existing.sessionId;
    state.authenticatedInviteCode = inviteCode;
    connectionManager.addConnection(existing.sessionId, ws);
    const count = existing.messages.filter(m => m.role === "user").length;
    send(buildAuthOk(data.invite.label, existing.sessionId, state.reportSkillPrompt, data.invite.max_messages_per_session, count, existing.messages, existing.ended));
    return true;
  }

  // Try DB restore
  const restored = await restoreSessionFromDb(config.djangoUrl, config.ownerToken, sessionId);
  console.log("[handleAuth] DB restore:", restored ? `HIT (history=${restored.history.length} entries)` : "MISS");
  if (restored && restored.inviteCode === inviteCode) {
    const data = await validateInvite(config.djangoUrl, config.ownerToken, inviteCode, { preview: true });
    if (!data.invite.is_valid) {
      recordAuthFailure(clientIp);
      send({ type: "auth_error", error: "Invalid or expired invite code" });
      return true; // handled (with error)
    }
    state.reportSkillPrompt = getReportSkillPrompt(data);
    const restoredSession = sessionStore.restoreSession({
      sessionId,
      sdkSessionId: restored.sdkSessionId || null,
      inviteCode,
      systemPrompt: buildSystemPrompt(data),
      permissions: data.role?.permissions ?? [],
      maxMessagesPerSession: data.invite.max_messages_per_session,
      customMcpServers: data.mcp_servers ?? [],
      skillToolServers: buildSkillToolServers(data),
      messages: restored.history,
    });
    state.authenticatedSessionId = restoredSession.sessionId;
    state.authenticatedInviteCode = inviteCode;
    connectionManager.addConnection(restoredSession.sessionId, ws);
    const count = restoredSession.messages.filter(m => m.role === "user").length;
    send(buildAuthOk(data.invite.label, restoredSession.sessionId, state.reportSkillPrompt, data.invite.max_messages_per_session, count, restoredSession.messages));
    return true;
  }

  return false; // not resumed, fall through to create new
}

function buildPageGeneratePrompt(packageConstraints: string): string {
  const constraintSection = packageConstraints
    ? `\n## Package Constraints (from the owner)\n${packageConstraints}\nFollow these constraints strictly when choosing packages.\n`
    : "";

  return `You are an expert React developer helping the owner create a custom page for their StandMeet profile.

## Your Task
Generate React code for a page based on the owner's description. The page will be built with Vite and rendered as SSG (Static Site Generation).

## Available Components
You can import these from '@standmeet/components':

- \`StandMeetContent\` — Renders a content entry. Props: \`path: string\`, \`className?: string\`
- \`StandMeetContentList\` — Renders content entries matching a prefix. Props: \`prefix: string\`, \`className?: string\`
- \`StandMeetAsset\` — Renders an asset image. Props: \`path: string\`, \`alt?: string\`, \`className?: string\`, \`width/height?: number\`
- \`StandMeetChat\` — Embedded chat widget. Props: \`position?: "inline" | "bottom-right"\`, \`className?: string\`
- \`StandMeetReferences\` — Shows content source badges. Props: \`className?: string\`

## Packages
Global npm packages are pre-installed and shared across all page builds. Use \`list_packages\` to see what's available.
Base packages (always available): react, react-dom, tailwindcss (v4), @headlessui/react, lucide-react, clsx, framer-motion.
If you need additional packages not in the global list, specify them in the \`must_use\` parameter of \`write_page_files\`.
${constraintSection}
## Tools Available
1. \`list_content\` — Discover available content entries
2. \`read_content\` — Read specific content to understand what data is available
3. \`list_assets\` — See available images/files
4. \`get_asset_url\` — Get URLs for assets to use in the page
5. \`list_packages\` — List globally installed npm packages
6. \`write_page_files\` — Save your generated code

## Workflow
1. First, use \`list_content\`, \`list_assets\`, and \`list_packages\` to understand what's available
2. Read specific content entries to understand their structure
3. Generate React code based on the owner's request and the available data
4. Use \`write_page_files\` to save the code — the main entry should be \`App.tsx\`
5. If you need additional npm packages beyond the globally installed set, specify them in the \`must_use\` parameter

## Code Guidelines
- Main entry point: \`App.tsx\` (default export a React component)
- Use Tailwind CSS for styling
- Make the page responsive (mobile-first)
- Ensure accessibility (semantic HTML, alt text, ARIA)
- Do NOT import Node.js modules or make network requests
- Do NOT use \`useState\` or \`useEffect\` for data fetching — all data is baked in at build time
- Use \`StandMeetContent\` / \`StandMeetContentList\` to render content — they read from pre-baked data
- Use \`StandMeetAsset\` for images — pass the asset path, it resolves the URL
- Keep the code clean and well-structured`;
}
