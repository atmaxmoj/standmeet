import { apiRequest } from "./client.js";
import type { ServerStatus, SiteSettings } from "../types.js";

export async function getSettings(): Promise<SiteSettings> {
  return apiRequest<SiteSettings>("/api/settings/");
}

export async function updateSettings(
  settings: Partial<SiteSettings>,
): Promise<SiteSettings> {
  return apiRequest<SiteSettings>("/api/settings/", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export async function getStatus(): Promise<ServerStatus> {
  return apiRequest<ServerStatus>("/api/status/");
}
