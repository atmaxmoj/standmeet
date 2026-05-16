import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isConfigured,
  loadConfig,
  saveConfig,
  getConfigPath,
} from "../config/manager.js";
import { getStatus } from "../api/settings-api.js";

export function registerSetupTools(server: McpServer): void {
  server.tool(
    "configure_server",
    "Configure the StandMeet server connection. Saves to ~/.standmeet/config.json",
    {
      url: z.string().describe("Server URL (e.g. https://standmeet.example.com)"),
      token: z.string().describe("Owner API token (smo_xxx)"),
    },
    async ({ url, token }) => {
      saveConfig({ server: { url, token } });
      return {
        content: [
          {
            type: "text" as const,
            text: `Server configured successfully!\nConfig saved to: ${getConfigPath()}\nURL: ${url}`,
          },
        ],
      };
    },
  );

  server.tool(
    "test_connection",
    "Test the connection to the StandMeet server",
    {},
    async () => {
      if (!isConfigured()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not configured. Run configure_server first.",
            },
          ],
          isError: true,
        };
      }
      try {
        const status = await getStatus();
        return {
          content: [
            {
              type: "text" as const,
              text: `Connection successful!\nServer version: ${status.version}\nContent entries: ${status.content_count}\nActive invites: ${status.active_invites}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "show_status",
    "Show current configuration and server status",
    {},
    async () => {
      const config = loadConfig();
      if (!config) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not configured. Run configure_server first.",
            },
          ],
          isError: true,
        };
      }

      let statusInfo = "";
      try {
        const status = await getStatus();
        statusInfo = `\n\nServer Status:\n  Version: ${status.version}\n  Content: ${status.content_count} entries\n  Active Invites: ${status.active_invites}\n  Public Access: ${status.public_access}`;
      } catch {
        statusInfo = "\n\nServer Status: Unable to connect";
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Configuration:\n  URL: ${config.server.url}\n  Token: ${config.server.token.slice(0, 8)}...${statusInfo}`,
          },
        ],
      };
    },
  );
}
