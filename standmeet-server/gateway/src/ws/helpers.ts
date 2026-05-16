import type { IncomingMessage } from "node:http";
import type { SessionInitData } from "../session/types.js";
import { buildSkillToolServer } from "../runtime/skill-tools.js";

export function getClientIp(req?: IncomingMessage): string {
  if (!req) return "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export function buildSystemPrompt(data: SessionInitData): string {
  const promptParts: string[] = [];
  const base =
    data.global_prompt ||
    "You are a helpful assistant representing the owner of this StandMeet profile. " +
      "Use the available tools to find information about the owner and answer questions.";
  promptParts.push(base);
  if (data.role?.prompt) promptParts.push(data.role.prompt);
  if (data.invite_prompt) promptParts.push(data.invite_prompt);
  if (data.skills?.length) {
    for (const skill of data.skills) {
      if (skill.prompt) {
        promptParts.push(`[Skill: ${skill.name}]\n${skill.prompt}`);
      }
    }
  }
  return promptParts.join("\n\n");
}

export function getReportSkillPrompt(data: SessionInitData): string | null {
  const reportSkill = data.skills?.find((s) => s.name === "Conversation Report");
  return reportSkill?.prompt ?? null;
}

export function buildSkillToolServers(
  data: SessionInitData,
): { name: string; server: unknown }[] {
  const skillToolServers: { name: string; server: unknown }[] = [];
  const sandboxEnabled = process.env.SANDBOX_ENABLED === "true";
  if (sandboxEnabled && data.skills?.length) {
    for (const skill of data.skills) {
      if (skill.scripts?.length) {
        const server = buildSkillToolServer(skill.name, skill.scripts);
        skillToolServers.push({ name: `skill-${skill.name}`, server });
      }
    }
  }
  return skillToolServers;
}
