import type { Asset, AssetListItem } from "../types.js";
import { loadConfig } from "../config/manager.js";
import { ApiError, apiRequest } from "./client.js";

export async function listAssets(prefix?: string): Promise<AssetListItem[]> {
  const params = new URLSearchParams();
  if (prefix) params.set("prefix", prefix);
  const qs = params.toString();
  return apiRequest<AssetListItem[]>(`/api/assets/${qs ? `?${qs}` : ""}`);
}

export async function getAsset(path: string): Promise<Asset> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return apiRequest<Asset>(`/api/assets/${cleanPath}/`);
}

export async function uploadAsset(
  fileBuffer: Buffer,
  filename: string,
  assetPath: string,
  visibility: "private" | "public" = "private",
): Promise<Asset> {
  const config = loadConfig();
  if (!config) throw new Error("Not configured.");
  const url = `${config.server.url.replace(/\/$/, "")}/api/assets/`;

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(fileBuffer)]), filename);
  formData.append("path", assetPath);
  formData.append("visibility", visibility);

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.server.token}` },
    body: formData,
  });

  if (!response.ok) {
    let message = `API error ${response.status}`;
    try {
      const ct = response.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json = await response.json();
        message = json.detail ?? json.error ?? JSON.stringify(json);
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<Asset>;
}

async function replaceAsset(
  path: string,
  fileBuffer: Buffer,
  filename: string,
): Promise<Asset> {
  const config = loadConfig();
  if (!config) throw new Error("Not configured.");
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const url = `${config.server.url.replace(/\/$/, "")}/api/assets/${cleanPath}/`;

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(fileBuffer)]), filename);

  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${config.server.token}` },
    body: formData,
  });

  if (!response.ok) {
    let message = `API error ${response.status}`;
    try {
      const ct = response.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json = await response.json();
        message = json.detail ?? json.error ?? JSON.stringify(json);
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<Asset>;
}

export async function updateAssetVisibility(
  path: string,
  visibility: "private" | "public",
): Promise<Asset> {
  const config = loadConfig();
  if (!config) throw new Error("Not configured.");
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const url = `${config.server.url.replace(/\/$/, "")}/api/assets/${cleanPath}/`;

  const formData = new FormData();
  formData.append("visibility", visibility);

  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${config.server.token}` },
    body: formData,
  });

  if (!response.ok) {
    let message = `API error ${response.status}`;
    try {
      const ct = response.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json = await response.json();
        message = json.detail ?? json.error ?? JSON.stringify(json);
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<Asset>;
}

export async function deleteAsset(path: string): Promise<void> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return apiRequest<void>(`/api/assets/${cleanPath}/`, { method: "DELETE" });
}
