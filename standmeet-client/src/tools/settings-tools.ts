import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSettings, updateSettings } from "../api/settings-api.js";
import type { ImIntegrationConfig } from "../types.js";

function registerGetSettings(server: McpServer): void {
  server.tool(
    "get_settings",
    "Get current server settings (public access, system prompt)",
    {},
    async () => {
      const settings = await getSettings();
      return {
        content: [
          {
            type: "text" as const,
            text: `Server Settings:\n  Public Access: ${settings.public_access}\n  System Prompt: ${settings.ai_system_prompt || "(not set)"}`,
          },
        ],
      };
    },
  );
}

function registerTogglePublicAccess(server: McpServer): void {
  server.tool(
    "toggle_public_access",
    "Enable or disable BYOAI public access",
    {
      enabled: z.boolean().describe("Whether to enable public access"),
    },
    async ({ enabled }) => {
      const settings = await updateSettings({ public_access: enabled });
      return {
        content: [
          {
            type: "text" as const,
            text: `Public access ${settings.public_access ? "enabled" : "disabled"}.`,
          },
        ],
      };
    },
  );
}

function registerUpdateSystemPrompt(server: McpServer): void {
  server.tool(
    "update_system_prompt",
    "Update the global AI system prompt used for visitor conversations",
    {
      prompt: z.string().describe("The system prompt text"),
    },
    async ({ prompt }) => {
      const settings = await updateSettings({ ai_system_prompt: prompt });
      return {
        content: [
          {
            type: "text" as const,
            text: `System prompt updated.\n\n${settings.ai_system_prompt}`,
          },
        ],
      };
    },
  );
}

function registerGetImIntegrations(server: McpServer): void {
  server.tool(
    "get_im_integrations",
    "Show IM integration configuration for Telegram, Discord, and Slack",
    {},
    async () => {
      const settings = await getSettings();
      const im = settings.im_integrations;
      const platforms = ["telegram", "discord", "slack"] as const;
      const lines = platforms.map((p) => {
        const cfg = im[p];
        if (!cfg) return `- ${p}: not configured`;
        const tokenDisplay = cfg.bot_token ? "****" + cfg.bot_token.slice(-4) : "(not set)";
        let extra = "";
        if (p === "discord" && cfg.application_id) extra += ` | app_id: ${cfg.application_id}`;
        if (p === "slack" && cfg.app_token) extra += ` | app_token: ****${cfg.app_token.slice(-4)}`;
        if (p === "telegram" && cfg.bot_username) extra += ` | bot: @${cfg.bot_username}`;
        return `- ${p}: ${cfg.enabled ? "enabled" : "disabled"} | token: ${tokenDisplay}${extra}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

function registerConfigureImPlatform(server: McpServer): void {
  server.tool(
    "configure_im_platform",
    "Enable/disable and set tokens for a Telegram, Discord, or Slack integration",
    {
      platform: z.enum(["telegram", "discord", "slack"]).describe("IM platform to configure"),
      enabled: z.boolean().optional().describe("Whether to enable the integration"),
      bot_token: z.string().optional().describe("Bot token"),
      application_id: z.string().optional().describe("Discord application ID (Discord only)"),
      app_token: z.string().optional().describe("Slack app-level token (Slack only)"),
    },
    async ({ platform, enabled, bot_token, application_id, app_token }) => {
      const settings = await getSettings();
      const current = settings.im_integrations[platform] ?? { enabled: false };
      const updated: ImIntegrationConfig = { ...current };
      if (enabled !== undefined) updated.enabled = enabled;
      if (bot_token !== undefined) updated.bot_token = bot_token;
      if (application_id !== undefined) updated.application_id = application_id;
      if (app_token !== undefined) updated.app_token = app_token;
      const result = await updateSettings({
        im_integrations: { ...settings.im_integrations, [platform]: updated },
      });
      const cfg = result.im_integrations[platform]!;
      return {
        content: [
          {
            type: "text" as const,
            text: `${platform} integration updated.\n  Enabled: ${cfg.enabled}\n  Token: ${cfg.bot_token ? "****" + cfg.bot_token.slice(-4) : "(not set)"}`,
          },
        ],
      };
    },
  );
}

export function registerSettingsTools(server: McpServer): void {
  registerGetSettings(server);
  registerTogglePublicAccess(server);
  registerUpdateSystemPrompt(server);
  registerGetImIntegrations(server);
  registerConfigureImPlatform(server);
}
