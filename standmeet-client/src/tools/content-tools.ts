import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listContent,
  readContent,
  updateContent,
  deleteContent,
  createContent,
} from "../api/content-api.js";

function registerListContent(server: McpServer): void {
  server.tool(
    "list_content",
    "List content entries in the personal repo",
    {
      prefix: z
        .string()
        .optional()
        .describe("Filter by path prefix (e.g. /profile)"),
    },
    async ({ prefix }) => {
      const entries = await listContent(prefix);
      if (entries.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No content found." }],
        };
      }
      const lines = entries.map(
        (e) => `- ${e.path}: ${e.summary || "(no summary)"} [${e.content_type}]`,
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}

function registerReadContent(server: McpServer): void {
  server.tool(
    "read_content",
    "Read content at a specific path",
    {
      path: z.string().describe("Content path (e.g. /profile/basic-info)"),
    },
    async ({ path }) => {
      const entry = await readContent(path);
      return {
        content: [
          {
            type: "text" as const,
            text: `Path: ${entry.path}\nSummary: ${entry.summary}\nContent:\n${JSON.stringify(entry.content, null, 2)}`,
          },
        ],
      };
    },
  );
}

function registerUpdateContent(server: McpServer): void {
  server.tool(
    "update_content",
    "Create or update content at a path",
    {
      path: z.string().describe("Content path (e.g. /profile/basic-info)"),
      content: z.string().describe("The content text (markdown supported)"),
      summary: z.string().optional().describe("Short summary for AI context"),
      visibility: z.enum(["private", "public"]).optional().describe("Visibility: 'public' for BYOAI visitors, 'private' for invite-only"),
    },
    async ({ path, content: text, summary, visibility }) => {
      const content = { text };
      try {
        const entry = await updateContent(path, content, summary, visibility);
        return {
          content: [
            {
              type: "text" as const,
              text: `Content updated at ${entry.path} (${entry.visibility})`,
            },
          ],
        };
      } catch {
        // If update fails (404), try create
        const entry = await createContent(path, content, summary, visibility);
        return {
          content: [
            {
              type: "text" as const,
              text: `Content created at ${entry.path} (${entry.visibility})`,
            },
          ],
        };
      }
    },
  );
}

function registerDeleteContent(server: McpServer): void {
  server.tool(
    "delete_content",
    "Delete content at a path",
    {
      path: z.string().describe("Content path to delete"),
    },
    async ({ path }) => {
      await deleteContent(path);
      return {
        content: [
          { type: "text" as const, text: `Content deleted: ${path}` },
        ],
      };
    },
  );
}

function registerSearchContent(server: McpServer): void {
  server.tool(
    "search_content",
    "Search content entries by keyword (matches path, summary, and content text)",
    {
      keyword: z.string().describe("Keyword to search for (case-insensitive)"),
    },
    async ({ keyword }) => {
      const entries = await listContent();
      const kw = keyword.toLowerCase();
      const matches: Array<{ path: string; summary: string; snippet: string }> = [];
      for (const entry of entries) {
        if (
          entry.path.toLowerCase().includes(kw) ||
          entry.summary.toLowerCase().includes(kw)
        ) {
          matches.push({ path: entry.path, summary: entry.summary, snippet: "" });
          continue;
        }
        // Check full content
        const full = await readContent(entry.path);
        const contentStr = JSON.stringify(full.content).toLowerCase();
        if (contentStr.includes(kw)) {
          matches.push({ path: entry.path, summary: entry.summary, snippet: "" });
        }
      }
      if (matches.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No content matching "${keyword}".` }],
        };
      }
      const lines = matches.map(
        (m) => `- ${m.path}: ${m.summary || "(no summary)"}`,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${matches.length} result(s) for "${keyword}":\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );
}

function registerSubmitSummary(server: McpServer): void {
  server.tool(
    "submit_summary",
    "Submit a daily summary (stored at /summaries/YYYY-MM-DD)",
    {
      content: z.string().describe("Summary content"),
      date: z
        .string()
        .optional()
        .describe("Date in YYYY-MM-DD format (defaults to today)"),
    },
    async ({ content, date }) => {
      const d = date || new Date().toISOString().slice(0, 10);
      const path = `/summaries/${d}`;
      const entry = await updateContent(
        path,
        { text: content, date: d },
        `Daily summary for ${d}`,
      ).catch(() => createContent(path, { text: content, date: d }, `Daily summary for ${d}`));
      return {
        content: [
          {
            type: "text" as const,
            text: `Summary saved at ${entry.path}`,
          },
        ],
      };
    },
  );
}

export function registerContentTools(server: McpServer): void {
  registerListContent(server);
  registerReadContent(server);
  registerUpdateContent(server);
  registerDeleteContent(server);
  registerSearchContent(server);
  registerSubmitSummary(server);
}
