import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

type AuthHeaders = Record<string, string>;

function createListContentTool(djangoUrl: string, authHeaders: AuthHeaders, roleId: string | null) {
  return tool(
    "list_content",
    "List available content entries with their paths and summaries. Use this to discover what content is available for the page.",
    { prefix: z.string().optional().describe("Filter by path prefix, e.g. 'projects/' or 'blog/'") },
    async (args) => {
      const prefix = args.prefix || "";
      const roleParam = roleId ? `&role_id=${roleId}` : "";
      const res = await fetch(
        `${djangoUrl}/api/repo/?prefix=${encodeURIComponent(prefix)}${roleParam}`,
        { headers: authHeaders },
      );
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error listing content: ${res.status}` }] };
      }
      const entries = (await res.json()) as Array<{ path: string; summary: string }>;
      const text =
        entries.map((e) => `- ${e.path}: ${e.summary}`).join("\n") || "No content found.";
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

function createReadContentTool(djangoUrl: string, authHeaders: AuthHeaders) {
  return tool(
    "read_content",
    "Read the full content at a specific path. Returns the content data as JSON.",
    { path: z.string().describe("Content path to read, e.g. 'profile' or 'projects/my-app'") },
    async (args) => {
      const res = await fetch(
        `${djangoUrl}/api/repo/${args.path.replace(/^\//, "")}/`,
        { headers: authHeaders },
      );
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Content not found: ${args.path}` }] };
      }
      const entry = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(entry.content, null, 2) }] };
    },
  );
}

function createListAssetsTool(djangoUrl: string, authHeaders: AuthHeaders) {
  return tool(
    "list_assets",
    "List available assets (images, files) that can be used in the page.",
    {},
    async () => {
      const res = await fetch(`${djangoUrl}/api/assets/`, { headers: authHeaders });
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error listing assets: ${res.status}` }] };
      }
      const assets = (await res.json()) as Array<{ path: string; content_type: string; size_bytes: number }>;
      const text =
        assets.map((a) => `- ${a.path} (${a.content_type}, ${Math.round(a.size_bytes / 1024)}KB)`).join("\n") ||
        "No assets found.";
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

function createGetAssetUrlTool(djangoUrl: string, authHeaders: AuthHeaders) {
  return tool(
    "get_asset_url",
    "Get the public URL for an asset to use in page code (e.g. for img src).",
    { path: z.string().describe("Asset path, e.g. 'avatar.jpg' or 'images/hero.png'") },
    async (args) => {
      const res = await fetch(
        `${djangoUrl}/api/assets/${args.path.replace(/^\//, "")}/`,
        { headers: authHeaders },
      );
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Asset not found: ${args.path}` }] };
      }
      const asset = (await res.json()) as { url: string };
      return { content: [{ type: "text" as const, text: asset.url }] };
    },
  );
}

function createListPackagesTool(djangoUrl: string, authHeaders: AuthHeaders) {
  return tool(
    "list_packages",
    "List globally installed npm packages available for page builds.",
    {},
    async () => {
      const res = await fetch(`${djangoUrl}/api/packages/`, { headers: authHeaders });
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error listing packages: ${res.status}` }] };
      }
      const packages = (await res.json()) as Array<{ name: string; version: string }>;
      const text =
        packages.map((p) => `- ${p.name}@${p.version}`).join("\n") || "No packages installed.";
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

function createWritePageFilesTool(djangoUrl: string, authHeaders: AuthHeaders, pageId: string) {
  return tool(
    "write_page_files",
    "Write source files for the page. Call this to save your generated React code. The main entry point should be App.tsx.",
    {
      files: z.record(z.string()).describe("Map of filename to file content, e.g. { 'App.tsx': '...', 'styles.css': '...' }"),
      must_use: z.array(z.string()).optional().describe("Additional npm packages that must be included beyond the globally installed set"),
    },
    async (args) => {
      const res = await fetch(`${djangoUrl}/api/pages/${pageId}/`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          source_files: args.files,
          must_use: args.must_use || [],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { content: [{ type: "text" as const, text: `Error saving page files: ${res.status} ${body}` }] };
      }
      const fileList = Object.keys(args.files).join(", ");
      return { content: [{ type: "text" as const, text: `Page files saved: ${fileList}` }] };
    },
  );
}

/**
 * Build MCP tool server for AI page generation.
 * Provides tools to access content, assets, and write page source files.
 */
export function buildPageToolServer(
  djangoUrl: string,
  ownerToken: string,
  pageId: string,
  roleId: string | null,
) {
  const authHeaders: AuthHeaders = {
    Authorization: `Bearer ${ownerToken}`,
    "Content-Type": "application/json",
  };

  return createSdkMcpServer({
    name: "page-builder",
    tools: [
      createListContentTool(djangoUrl, authHeaders, roleId),
      createReadContentTool(djangoUrl, authHeaders),
      createListAssetsTool(djangoUrl, authHeaders),
      createGetAssetUrlTool(djangoUrl, authHeaders),
      createListPackagesTool(djangoUrl, authHeaders),
      createWritePageFilesTool(djangoUrl, authHeaders, pageId),
    ],
  });
}
