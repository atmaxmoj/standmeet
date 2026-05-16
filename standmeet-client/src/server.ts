import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupTools } from "./tools/setup-tools.js";
import { registerContentTools } from "./tools/content-tools.js";
import { registerInviteTools } from "./tools/invite-tools.js";
import { registerRoleTools } from "./tools/role-tools.js";
import { registerSettingsTools } from "./tools/settings-tools.js";
import { registerMcpServerTools } from "./tools/mcp-server-tools.js";
import { registerSkillTools } from "./tools/skill-tools.js";
import { registerAssetTools } from "./tools/asset-tools.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "StandMeet",
    version: "0.1.0",
  });

  registerSetupTools(server);
  registerContentTools(server);
  registerInviteTools(server);
  registerRoleTools(server);
  registerSettingsTools(server);
  registerMcpServerTools(server);
  registerSkillTools(server);
  registerAssetTools(server);

  return server;
}
