import { apiRequest } from "./client.js";
import type { McpServer } from "../types.js";

export async function createMcpServer(
  name: string,
  config: Record<string, unknown> = {},
): Promise<McpServer> {
  return apiRequest<McpServer>("/api/mcp-servers/", {
    method: "POST",
    body: JSON.stringify({ name, config }),
  });
}

export async function listMcpServers(): Promise<McpServer[]> {
  return apiRequest<McpServer[]>("/api/mcp-servers/");
}

export async function getMcpServer(id: string): Promise<McpServer> {
  return apiRequest<McpServer>(`/api/mcp-servers/${id}/`);
}

export async function updateMcpServer(
  id: string,
  data: { name?: string; config?: Record<string, unknown> },
): Promise<McpServer> {
  return apiRequest<McpServer>(`/api/mcp-servers/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteMcpServer(id: string): Promise<void> {
  return apiRequest<void>(`/api/mcp-servers/${id}/`, {
    method: "DELETE",
  });
}
