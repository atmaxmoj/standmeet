import { apiRequest } from "./client.js";

export interface GlobalPackage {
  name: string;
  version: string;
}

export async function listGlobalPackages(): Promise<GlobalPackage[]> {
  return apiRequest<GlobalPackage[]>("/api/packages/");
}

export async function installPackage(name: string): Promise<GlobalPackage> {
  return apiRequest<GlobalPackage>("/api/packages/", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function uninstallPackage(name: string): Promise<void> {
  return apiRequest<void>(`/api/packages/${encodeURIComponent(name)}/`, {
    method: "DELETE",
  });
}
