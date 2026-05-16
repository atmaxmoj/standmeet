import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
} from "../api/mcp-server-api.js";

export function registerMcpServerTools(server: McpServer): void {
  server.tool(
    "list_mcp_servers",
    "List all configured external MCP servers",
    {},
    async () => {
      const servers = await listMcpServers();
      if (servers.length === 0) {
        return { content: [{ type: "text" as const, text: "No MCP servers configured." }] };
      }
      const lines = servers.map(
        (s) => `- ${s.name} (id: ${s.id})\n  Config: ${JSON.stringify(s.config)}`,
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "create_mcp_server",
    "Add a new external MCP server configuration",
    {
      name: z.string().describe("Display name for the MCP server"),
      config: z.string().describe("JSON string of the MCP server configuration"),
    },
    async ({ name, config }) => {
      const parsed = JSON.parse(config) as Record<string, unknown>;
      const created = await createMcpServer(name, parsed);
      return {
        content: [
          {
            type: "text" as const,
            text: `MCP server created!\n  ID: ${created.id}\n  Name: ${created.name}\n  Config: ${JSON.stringify(created.config)}`,
          },
        ],
      };
    },
  );

  server.tool(
    "update_mcp_server",
    "Update an existing MCP server's name or configuration",
    {
      id: z.string().describe("MCP server ID"),
      name: z.string().optional().describe("New display name"),
      config: z.string().optional().describe("New JSON config string"),
    },
    async ({ id, name, config }) => {
      const data: { name?: string; config?: Record<string, unknown> } = {};
      if (name !== undefined) data.name = name;
      if (config !== undefined) data.config = JSON.parse(config) as Record<string, unknown>;
      const updated = await updateMcpServer(id, data);
      return {
        content: [
          {
            type: "text" as const,
            text: `MCP server ${updated.id} updated.\n  Name: ${updated.name}\n  Config: ${JSON.stringify(updated.config)}`,
          },
        ],
      };
    },
  );

  server.tool(
    "delete_mcp_server",
    "Delete an external MCP server configuration",
    {
      id: z.string().describe("MCP server ID to delete"),
    },
    async ({ id }) => {
      await deleteMcpServer(id);
      return {
        content: [{ type: "text" as const, text: `MCP server ${id} deleted.` }],
      };
    },
  );
}
