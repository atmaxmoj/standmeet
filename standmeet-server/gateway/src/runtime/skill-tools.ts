import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z, type ZodTypeAny } from "zod";
import { runInSandbox } from "./sandbox.js";

type SkillScriptDef = {
  filename: string;
  language: string;
  content: string;
  description: string;
  parameters: Array<{
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
  }>;
};

function buildInputSchema(params: SkillScriptDef["parameters"]): Record<string, ZodTypeAny> {
  const schema: Record<string, ZodTypeAny> = {};
  for (const param of params) {
    let zodType: ZodTypeAny;
    switch (param.type) {
      case "number":
      case "integer":
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      default:
        zodType = z.string();
    }
    if (param.description) {
      zodType = zodType.describe(param.description);
    }
    if (!param.required) {
      zodType = zodType.optional();
    }
    schema[param.name] = zodType;
  }
  return schema;
}

function sanitizeToolName(skillName: string, filename: string): string {
  // Remove extension and sanitize: only alphanumeric + underscore
  const base = filename.replace(/\.[^.]+$/, "");
  const prefix = skillName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const suffix = base.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  return `${prefix}_${suffix}`;
}

export function buildSkillToolServer(skillName: string, scripts: SkillScriptDef[]) {
  const tools = scripts.map((script) => {
    const toolName = sanitizeToolName(skillName, script.filename);
    const description = script.description || `Run ${script.filename} from skill "${skillName}"`;
    const inputSchema = buildInputSchema(script.parameters);

    return tool(
      toolName,
      description,
      inputSchema,
      async (args: Record<string, unknown>) => {
        const result = await runInSandbox({
          language: script.language,
          script: script.content,
          args,
        });

        if (result.timedOut) {
          return {
            content: [{ type: "text" as const, text: "Script execution timed out (30s limit)" }],
          };
        }

        const output = result.stdout || result.stderr || "(no output)";
        const prefix = result.exitCode !== 0 ? `[exit code ${result.exitCode}]\n` : "";
        return {
          content: [{ type: "text" as const, text: prefix + output }],
        };
      },
    );
  });

  return createSdkMcpServer({
    name: `skill-${skillName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}`,
    tools,
  });
}
