import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createInvite,
  listInvites,
  revokeInvite,
  updateInvite,
  deleteInvite,
  listChatLogs,
  deleteChatLog,
  clearChatLogs,
} from "../api/invite-api.js";

function registerCreateInvite(server: McpServer): void {
  server.tool(
    "create_invite",
    "Create a new invite code for visitors",
    {
      label: z.string().describe("Label for the invite (e.g. 'For Alice - recruiter')"),
      role_id: z.string().optional().describe("Role ID to assign to the invite"),
      max_uses: z.number().optional().describe("Maximum number of uses"),
      expires_in_hours: z.number().optional().describe("Hours until expiration"),
      prompt: z.string().optional().describe("Custom AI system prompt for this invite"),
    },
    async ({ label, role_id, max_uses, expires_in_hours, prompt }) => {
      const invite = await createInvite({ label, role_id, max_uses, expires_in_hours, prompt });
      return {
        content: [
          {
            type: "text" as const,
            text: `Invite created!\n  Code: ${invite.code}\n  Label: ${invite.label}\n  Max uses: ${invite.max_uses ?? "unlimited"}\n  Expires: ${invite.expires_at ?? "never"}\n  Role: ${invite.role_id ?? "none"}`,
          },
        ],
      };
    },
  );
}

function registerListInvites(server: McpServer): void {
  server.tool(
    "list_invites",
    "List all invite codes with their status",
    {},
    async () => {
      const invites = await listInvites();
      if (invites.length === 0) {
        return { content: [{ type: "text" as const, text: "No invites found." }] };
      }
      const lines = invites.map(
        (i) =>
          `- ${i.code} | ${i.label} | active: ${i.is_active} | uses: ${i.use_count}/${i.max_uses ?? "∞"} | expires: ${i.expires_at ?? "never"} | role: ${i.role_id ?? "none"}`,
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

function registerUpdateInvite(server: McpServer): void {
  server.tool(
    "update_invite",
    "Update an invite's role or custom prompt",
    {
      code: z.string().describe("Invite code (sm_xxx)"),
      role_id: z.string().nullable().optional().describe("Role ID to assign (null to remove)"),
      prompt: z.string().optional().describe("Custom AI system prompt"),
    },
    async ({ code, role_id, prompt }) => {
      const data: { role_id?: string | null; prompt?: string } = {};
      if (role_id !== undefined) data.role_id = role_id;
      if (prompt !== undefined) data.prompt = prompt;
      const invite = await updateInvite(code, data);
      return {
        content: [
          {
            type: "text" as const,
            text: `Invite ${invite.code} updated. Role: ${invite.role_id ?? "none"}, Prompt: ${invite.prompt || "(not set)"}`,
          },
        ],
      };
    },
  );
}

function registerRevokeInvite(server: McpServer): void {
  server.tool(
    "revoke_invite",
    "Revoke (deactivate) an invite code",
    {
      code: z.string().describe("Invite code to revoke (sm_xxx)"),
    },
    async ({ code }) => {
      const invite = await revokeInvite(code);
      return {
        content: [{ type: "text" as const, text: `Invite ${invite.code} revoked.` }],
      };
    },
  );
}

function registerDeleteInvite(server: McpServer): void {
  server.tool(
    "delete_invite",
    "Permanently delete an invite code",
    {
      code: z.string().describe("Invite code to delete (sm_xxx)"),
    },
    async ({ code }) => {
      await deleteInvite(code);
      return {
        content: [{ type: "text" as const, text: `Invite ${code} deleted.` }],
      };
    },
  );
}

function registerChatLogTools(server: McpServer): void {
  server.tool(
    "list_chat_logs",
    "List chat logs for an invite code",
    {
      code: z.string().describe("Invite code (sm_xxx)"),
    },
    async ({ code }) => {
      const result = await listChatLogs(code);
      if (result.logs.length === 0) {
        return { content: [{ type: "text" as const, text: "No chat logs found." }] };
      }
      const lines = result.logs.map(
        (l: { created_at: string; user_message: string; assistant_message: string }) =>
          `[${l.created_at}]\n  User: ${l.user_message}\n  AI: ${l.assistant_message}`,
      );
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    },
  );

  server.tool(
    "delete_chat_log",
    "Delete a specific chat log entry",
    {
      code: z.string().describe("Invite code (sm_xxx)"),
      log_id: z.string().describe("Chat log ID to delete"),
    },
    async ({ code, log_id }) => {
      await deleteChatLog(code, log_id);
      return {
        content: [{ type: "text" as const, text: `Chat log ${log_id} deleted.` }],
      };
    },
  );

  server.tool(
    "clear_chat_logs",
    "Delete all chat logs for an invite code",
    {
      code: z.string().describe("Invite code (sm_xxx)"),
    },
    async ({ code }) => {
      await clearChatLogs(code);
      return {
        content: [{ type: "text" as const, text: `All chat logs for ${code} cleared.` }],
      };
    },
  );
}

export function registerInviteTools(server: McpServer): void {
  registerCreateInvite(server);
  registerListInvites(server);
  registerUpdateInvite(server);
  registerRevokeInvite(server);
  registerDeleteInvite(server);
  registerChatLogTools(server);
}
