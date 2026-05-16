import { loadConfig } from "../config/manager.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getBaseConfig() {
  const config = loadConfig();
  if (!config) {
    throw new Error("Not configured. Run configure_server first.");
  }
  return config;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const config = getBaseConfig();
  const url = `${config.server.url.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.server.token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        response.status,
        "Authentication failed — check your token in Setup. It may be expired or invalid.",
      );
    }
    let message = `API error ${response.status}`;
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = await response.json();
        message = json.detail ?? json.error ?? JSON.stringify(json);
      }
    } catch {
      // ignore parse errors, use generic message
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function apiUpload<T>(
  path: string,
  fileBuffer: Buffer,
  filename: string,
): Promise<T> {
  const config = getBaseConfig();
  const url = `${config.server.url.replace(/\/$/, "")}${path}`;

  // Build multipart/form-data manually using Blob
  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(fileBuffer)]), filename);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.server.token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let message = `API error ${response.status}`;
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = await response.json();
        message = json.detail ?? json.error ?? JSON.stringify(json);
      }
    } catch {
      // ignore parse errors
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}
