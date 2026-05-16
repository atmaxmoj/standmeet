import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  importSkillMd,
  exportSkillMd,
} from "../api/skill-api.js";

function registerListSkills(server: McpServer): void {
  server.tool(
    "list_skills",
    "List all configured AI skills",
    {},
    async () => {
      const skills = await listSkills();
      if (skills.length === 0) {
        return { content: [{ type: "text" as const, text: "No skills configured." }] };
      }
      const lines = skills.map(
        (s) =>
          `- ${s.name} (id: ${s.id}) | source: ${s.source} | builtin: ${s.is_builtin}${s.description ? `\n  ${s.description}` : ""}`,
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

function registerGetSkill(server: McpServer): void {
  server.tool(
    "get_skill",
    "Get full details of a skill including its prompt",
    {
      id: z.string().describe("Skill ID"),
    },
    async ({ id }) => {
      const skill = await getSkill(id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill: ${skill.name} (id: ${skill.id})\n  Source: ${skill.source}\n  Builtin: ${skill.is_builtin}\n  Description: ${skill.description || "(none)"}\n  Prompt:\n${skill.prompt || "(none)"}`,
          },
        ],
      };
    },
  );
}

function registerCreateSkill(server: McpServer): void {
  server.tool(
    "create_skill",
    "Create a new AI skill",
    {
      name: z.string().describe("Skill name"),
      description: z.string().optional().describe("Short description of the skill"),
      prompt: z.string().optional().describe("The skill prompt text"),
    },
    async ({ name, description, prompt }) => {
      const skill = await createSkill(name, description ?? "", prompt ?? "");
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill created!\n  ID: ${skill.id}\n  Name: ${skill.name}`,
          },
        ],
      };
    },
  );
}

function registerUpdateSkill(server: McpServer): void {
  server.tool(
    "update_skill",
    "Update an existing skill's name, description, or prompt",
    {
      id: z.string().describe("Skill ID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      prompt: z.string().optional().describe("New prompt text"),
    },
    async ({ id, name, description, prompt }) => {
      const data: { name?: string; description?: string; prompt?: string } = {};
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (prompt !== undefined) data.prompt = prompt;
      const skill = await updateSkill(id, data);
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill ${skill.id} updated.\n  Name: ${skill.name}\n  Description: ${skill.description || "(none)"}`,
          },
        ],
      };
    },
  );
}

function registerDeleteSkill(server: McpServer): void {
  server.tool(
    "delete_skill",
    "Delete a skill",
    {
      id: z.string().describe("Skill ID to delete"),
    },
    async ({ id }) => {
      await deleteSkill(id);
      return {
        content: [{ type: "text" as const, text: `Skill ${id} deleted.` }],
      };
    },
  );
}

function registerImportExportSkills(server: McpServer): void {
  server.tool(
    "import_skill",
    "Import a skill from skill.md format",
    {
      skill_md_raw: z.string().describe("Raw skill.md content to import"),
    },
    async ({ skill_md_raw }) => {
      const skill = await importSkillMd(skill_md_raw);
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill imported!\n  ID: ${skill.id}\n  Name: ${skill.name}`,
          },
        ],
      };
    },
  );

  server.tool(
    "export_skill",
    "Export a skill in skill.md format",
    {
      id: z.string().describe("Skill ID to export"),
    },
    async ({ id }) => {
      const md = await exportSkillMd(id);
      return {
        content: [{ type: "text" as const, text: md }],
      };
    },
  );
}

export function registerSkillTools(server: McpServer): void {
  registerListSkills(server);
  registerGetSkill(server);
  registerCreateSkill(server);
  registerUpdateSkill(server);
  registerDeleteSkill(server);
  registerImportExportSkills(server);
}
