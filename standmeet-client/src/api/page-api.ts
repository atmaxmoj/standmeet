import { apiRequest } from "./client.js";

interface PageMeta {
  title: string;
  description: string;
  favicon_asset_path: string | null;
  og_image_asset_path: string | null;
  custom_head: string;
}

interface PageListItem {
  id: string;
  name: string;
  description: string;
  status: string;
  role_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Page {
  id: string;
  name: string;
  description: string;
  status: string;
  source_files: Record<string, string>;
  must_use: string[];
  dont_use: string[];
  package_constraints: string;
  meta: PageMeta;
  build_log: string;
  role_id: string | null;
  created_at: string;
  updated_at: string;
}

interface StorageUsage {
  used_bytes: number;
  total_bytes: number;
}

export async function listPages(): Promise<PageListItem[]> {
  return apiRequest<PageListItem[]>("/api/pages/");
}

export async function getPage(id: string): Promise<Page> {
  return apiRequest<Page>(`/api/pages/${id}/`);
}

export async function createPage(data: {
  name: string;
  description?: string;
  source_files?: Record<string, string>;
  must_use?: string[];
  dont_use?: string[];
  package_constraints?: string;
  meta?: Partial<PageMeta>;
  role_id?: string | null;
}): Promise<Page> {
  return apiRequest<Page>("/api/pages/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updatePage(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    source_files: Record<string, string>;
    must_use: string[];
    dont_use: string[];
    package_constraints: string;
    meta: Partial<PageMeta>;
    role_id: string | null;
  }>,
): Promise<Page> {
  return apiRequest<Page>(`/api/pages/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deletePage(id: string): Promise<void> {
  return apiRequest<void>(`/api/pages/${id}/`, {
    method: "DELETE",
  });
}

export async function triggerBuild(id: string): Promise<{ status: string; id: string }> {
  return apiRequest<{ status: string; id: string }>(`/api/pages/${id}/build/`, {
    method: "POST",
  });
}

export async function getBuildLog(id: string): Promise<{ build_log: string; status: string }> {
  return apiRequest<{ build_log: string; status: string }>(`/api/pages/${id}/build-log/`);
}

export async function activatePage(id: string): Promise<{ activated: string }> {
  return apiRequest<{ activated: string }>(`/api/pages/${id}/activate/`, {
    method: "POST",
  });
}

export async function getStorageUsage(): Promise<StorageUsage> {
  return apiRequest<StorageUsage>("/api/storage/usage/");
}
