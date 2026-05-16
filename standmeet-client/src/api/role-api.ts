import { apiRequest } from "./client.js";
import type { Role, PathPermission } from "../types.js";

export async function createRole(
  name: string,
  permissions: PathPermission[] = [],
): Promise<Role> {
  return apiRequest<Role>("/api/roles/", {
    method: "POST",
    body: JSON.stringify({ name, permissions }),
  });
}

export async function listRoles(): Promise<Role[]> {
  return apiRequest<Role[]>("/api/roles/");
}

export async function getRole(id: string): Promise<Role> {
  return apiRequest<Role>(`/api/roles/${id}/`);
}

export async function updateRole(
  id: string,
  data: { name?: string; permissions?: PathPermission[]; prompt?: string },
): Promise<Role> {
  return apiRequest<Role>(`/api/roles/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteRole(id: string): Promise<void> {
  return apiRequest<void>(`/api/roles/${id}/`, {
    method: "DELETE",
  });
}
