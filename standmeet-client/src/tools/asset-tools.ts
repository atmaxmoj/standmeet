import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import {
  listAssets,
  getAsset,
  uploadAsset,
  updateAssetVisibility,
  deleteAsset,
} from "../api/asset-api.js";

function registerListAssets(server: McpServer): void {
  server.tool(
    "list_assets",
    "List uploaded assets (files)",
    {
      prefix: z
        .string()
        .optional()
        .describe("Filter by path prefix (e.g. /photos)"),
    },
    async ({ prefix }) => {
      const assets = await listAssets(prefix);
      if (assets.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No assets found." }],
        };
      }
      const lines = assets.map(
        (a) =>
          `- ${a.path} (${a.filename}, ${a.mime_type}, ${a.size} bytes, ${a.visibility})`,
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}

function registerUploadAsset(server: McpServer): void {
  server.tool(
    "upload_asset",
    "Upload a file as an asset",
    {
      local_path: z.string().describe("Local file path to upload"),
      asset_path: z
        .string()
        .describe("Target asset path (e.g. /photos/avatar.jpg)"),
      visibility: z
        .enum(["private", "public"])
        .optional()
        .describe("Visibility (default: private)"),
    },
    async ({ local_path, asset_path, visibility }) => {
      const fileBuffer = readFileSync(local_path);
      const filename = basename(local_path);
      const asset = await uploadAsset(
        Buffer.from(fileBuffer),
        filename,
        asset_path,
        visibility ?? "private",
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Uploaded ${asset.filename} to ${asset.path} (${asset.visibility}, ${asset.size} bytes)`,
          },
        ],
      };
    },
  );
}

function registerGetAssetUrl(server: McpServer): void {
  server.tool(
    "get_asset_url",
    "Get download URL for an asset",
    {
      path: z.string().describe("Asset path (e.g. /photos/avatar.jpg)"),
    },
    async ({ path }) => {
      const asset = await getAsset(path);
      return {
        content: [
          {
            type: "text" as const,
            text: `${asset.filename} (${asset.mime_type}, ${asset.size} bytes)\nURL: ${asset.download_url ?? "N/A"}`,
          },
        ],
      };
    },
  );
}

function registerUpdateAssetVisibility(server: McpServer): void {
  server.tool(
    "update_asset_visibility",
    "Change asset visibility",
    {
      path: z.string().describe("Asset path"),
      visibility: z
        .enum(["private", "public"])
        .describe("New visibility"),
    },
    async ({ path, visibility }) => {
      const asset = await updateAssetVisibility(path, visibility);
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated ${asset.path} visibility to ${asset.visibility}`,
          },
        ],
      };
    },
  );
}

function registerDeleteAsset(server: McpServer): void {
  server.tool(
    "delete_asset",
    "Delete an asset",
    {
      path: z.string().describe("Asset path to delete"),
    },
    async ({ path }) => {
      await deleteAsset(path);
      return {
        content: [
          { type: "text" as const, text: `Asset deleted: ${path}` },
        ],
      };
    },
  );
}

export function registerAssetTools(server: McpServer): void {
  registerListAssets(server);
  registerUploadAsset(server);
  registerGetAssetUrl(server);
  registerUpdateAssetVisibility(server);
  registerDeleteAsset(server);
}
