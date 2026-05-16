import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { PathPermission } from "../session/types.js";

type ContentEntry = {
  path: string;
  summary: string;
  content: unknown;
  content_type: string;
  show_as_source?: boolean;
};

function isAllowed(path: string, permissions: PathPermission[]): boolean {
  if (permissions.length === 0) return true;

  const sorted = [...permissions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const perm of sorted) {
    if (matchGlob(path, perm.path_pattern)) {
      return perm.action === "allow";
    }
  }
  return false; // default deny
}

function matchGlob(path: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regex}$`).test(path);
}

export function buildMcpServer(
  permissions: PathPermission[],
  djangoUrl: string,
  ownerToken: string,
  publicOnly?: boolean,
  readSourcesCollector?: string[],
) {
  const visibilityParam = publicOnly ? "&visibility=public" : "";

  const listContent = tool(
    "list_content",
    "List available content paths with summaries",
    { prefix: z.string().optional().describe("Filter by path prefix") },
    async (args) => {
      const prefix = args.prefix || "";
      const res = await fetch(`${djangoUrl}/api/repo/?prefix=${encodeURIComponent(prefix)}${visibilityParam}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error listing content: ${res.status}` }] };
      }
      const entries: ContentEntry[] = await res.json();
      const filtered = publicOnly ? entries : entries.filter((e) => isAllowed(e.path, permissions));
      const text =
        filtered.map((e) => `- ${e.path}: ${e.summary}`).join("\n") || "No content found.";
      return { content: [{ type: "text" as const, text }] };
    },
  );

  const readContent = tool(
    "read_content",
    "Read content at a specific path",
    { path: z.string().describe("Content path to read") },
    async (args) => {
      if (!publicOnly && !isAllowed(args.path, permissions)) {
        return { content: [{ type: "text" as const, text: `Access denied: ${args.path}` }] };
      }
      const res = await fetch(`${djangoUrl}/api/repo/${args.path.replace(/^\//, "")}/`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      if (!res.ok) {
        return {
          content: [{ type: "text" as const, text: `Content not found: ${args.path}` }],
        };
      }
      const entry: ContentEntry = await res.json();
      if (readSourcesCollector && entry.show_as_source !== false && !readSourcesCollector.includes(entry.path)) {
        readSourcesCollector.push(entry.path);
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(entry.content, null, 2) }],
      };
    },
  );

  const searchContent = tool(
    "search_content",
    "Search across content by keyword",
    { query: z.string().describe("Search keyword") },
    async (args) => {
      const res = await fetch(`${djangoUrl}/api/repo/?${publicOnly ? "visibility=public" : ""}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error searching: ${res.status}` }] };
      }
      const entries: ContentEntry[] = await res.json();
      const q = args.query.toLowerCase();
      const matches = entries
        .filter((e) => publicOnly || isAllowed(e.path, permissions))
        .filter(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            e.summary.toLowerCase().includes(q) ||
            JSON.stringify(e.content).toLowerCase().includes(q),
        );
      const text =
        matches.map((e) => `- ${e.path}: ${e.summary}`).join("\n") || "No matches found.";
      return { content: [{ type: "text" as const, text }] };
    },
  );

  return createSdkMcpServer({
    name: "standmeet",
    tools: [listContent, readContent, searchContent],
  });
}

// Export for testing
export { isAllowed };
