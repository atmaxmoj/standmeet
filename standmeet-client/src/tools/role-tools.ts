import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createRole,
  listRoles,
  getRole,
  updateRole,
  deleteRole,
} from "../api/role-api.js";

const permissionSchema = z.object({
  action: z.enum(["allow", "deny"]),
  path_pattern: z.string().describe("Glob pattern (e.g. /profile/**, /skills/*)"),
  order: z.number().optional(),
});

function registerListRoles(server: McpServer): void {
  server.tool(
    "list_roles",
    "List all roles with their permission rules",
    {},
    async () => {
      const roles = await listRoles();
      if (roles.length === 0) {
        return { content: [{ type: "text" as const, text: "No roles found." }] };
      }
      const lines = roles.map((r) => {
        const perms = r.permissions.length > 0
          ? r.permissions.map((p) => `    ${p.action} ${p.path_pattern}`).join("\n")
          : "    (no rules — all paths denied)";
        return `- ${r.name} (${r.id})\n  Prompt: ${r.prompt || "(not set)"}\n  Rules:\n${perms}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    },
  );
}

function registerGetRole(server: McpServer): void {
  server.tool(
    "get_role",
    "Get a role's details by ID",
    {
      id: z.string().describe("Role ID"),
    },
    async ({ id }) => {
      const role = await getRole(id);
      const perms = role.permissions.length > 0
        ? role.permissions.map((p) => `  ${p.action} ${p.path_pattern}`).join("\n")
        : "  (no rules)";
      return {
        content: [
          {
            type: "text" as const,
            text: `Role: ${role.name} (${role.id})\nPrompt: ${role.prompt || "(not set)"}\nRules:\n${perms}`,
          },
        ],
      };
    },
  );
}

function registerCreateRole(server: McpServer): void {
  server.tool(
    "create_role",
    "Create a new role with permission rules",
    {
      name: z.string().describe("Role name"),
      permissions: z.array(permissionSchema).optional().describe("Permission rules"),
      prompt: z.string().optional().describe("Custom system prompt for this role"),
    },
    async ({ name, permissions, prompt }) => {
      const role = await createRole(name, permissions ?? []);
      if (prompt) {
        await updateRole(role.id, { prompt });
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Role "${role.name}" created (${role.id}) with ${role.permissions.length} rules.`,
          },
        ],
      };
    },
  );
}

function registerUpdateRole(server: McpServer): void {
  server.tool(
    "update_role",
    "Update a role's name, permissions, or prompt",
    {
      id: z.string().describe("Role ID"),
      name: z.string().optional().describe("New role name"),
      permissions: z.array(permissionSchema).optional().describe("New permission rules (replaces all existing)"),
      prompt: z.string().optional().describe("Custom system prompt"),
    },
    async ({ id, name, permissions, prompt }) => {
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (permissions !== undefined) data.permissions = permissions;
      if (prompt !== undefined) data.prompt = prompt;
      const role = await updateRole(id, data);
      return {
        content: [
          {
            type: "text" as const,
            text: `Role "${role.name}" updated. ${role.permissions.length} rules.`,
          },
        ],
      };
    },
  );
}

function registerDeleteRole(server: McpServer): void {
  server.tool(
    "delete_role",
    "Delete a role",
    {
      id: z.string().describe("Role ID to delete"),
    },
    async ({ id }) => {
      await deleteRole(id);
      return {
        content: [{ type: "text" as const, text: `Role ${id} deleted.` }],
      };
    },
  );
}

export function registerRoleTools(server: McpServer): void {
  registerListRoles(server);
  registerGetRole(server);
  registerCreateRole(server);
  registerUpdateRole(server);
  registerDeleteRole(server);
}
