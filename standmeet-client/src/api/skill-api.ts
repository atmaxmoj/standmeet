import { apiRequest, apiUpload } from "./client.js";
import type { Skill } from "../types.js";

export async function createSkill(
  name: string,
  description: string = "",
  prompt: string = "",
): Promise<Skill> {
  return apiRequest<Skill>("/api/skills/", {
    method: "POST",
    body: JSON.stringify({ name, description, prompt }),
  });
}

export async function listSkills(): Promise<Skill[]> {
  return apiRequest<Skill[]>("/api/skills/");
}

export async function getSkill(id: string): Promise<Skill> {
  return apiRequest<Skill>(`/api/skills/${id}/`);
}

export async function updateSkill(
  id: string,
  data: { name?: string; description?: string; prompt?: string },
): Promise<Skill> {
  return apiRequest<Skill>(`/api/skills/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSkill(id: string): Promise<void> {
  return apiRequest<void>(`/api/skills/${id}/`, {
    method: "DELETE",
  });
}

export async function importSkillMd(skillMdRaw: string): Promise<Skill> {
  return apiRequest<Skill>("/api/skills/import/", {
    method: "POST",
    body: JSON.stringify({ skill_md_raw: skillMdRaw }),
  });
}

export async function importSkillZip(zipBuffer: Buffer, filename: string): Promise<Skill> {
  return apiUpload<Skill>("/api/skills/import-zip/", zipBuffer, filename);
}

export async function exportSkillMd(id: string): Promise<string> {
  const res = await apiRequest<{ skill_md: string }>(`/api/skills/${id}/export/`);
  return res.skill_md;
}

export async function importSkillFromUrl(url: string): Promise<Skill> {
  return apiRequest<Skill>("/api/skills/import-url/", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}
