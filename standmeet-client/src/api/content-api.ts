import { apiRequest } from "./client.js";
import type { ContentEntry, ContentListItem } from "../types.js";

export async function listContent(
  prefix?: string,
): Promise<ContentListItem[]> {
  const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return apiRequest<ContentListItem[]>(`/api/repo/${query}`);
}

export async function readContent(path: string): Promise<ContentEntry> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return apiRequest<ContentEntry>(`/api/repo/${cleanPath}/`);
}

export async function updateContent(
  path: string,
  content: Record<string, unknown>,
  summary?: string,
  visibility?: "private" | "public",
  showAsSource?: boolean,
): Promise<ContentEntry> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const body: Record<string, unknown> = {
    content,
    summary: summary ?? "",
    visibility: visibility ?? "private",
  };
  if (showAsSource !== undefined) body.show_as_source = showAsSource;
  return apiRequest<ContentEntry>(`/api/repo/${cleanPath}/`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function createContent(
  path: string,
  content: Record<string, unknown>,
  summary?: string,
  visibility?: "private" | "public",
  showAsSource?: boolean,
): Promise<ContentEntry> {
  const body: Record<string, unknown> = {
    path,
    content,
    summary: summary ?? "",
    visibility: visibility ?? "private",
  };
  if (showAsSource !== undefined) body.show_as_source = showAsSource;
  return apiRequest<ContentEntry>("/api/repo/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteContent(path: string): Promise<void> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return apiRequest<void>(`/api/repo/${cleanPath}/`, {
    method: "DELETE",
  });
}
