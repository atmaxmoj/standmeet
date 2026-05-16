import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatHistoryEntry } from "../session/types.js";
import { getMockConfig } from "./mock-state.js";

export async function generateSummary(
  messages: ChatHistoryEntry[],
  summaryPrompt: string,
): Promise<string> {
  const mock = getMockConfig();

  // Format conversation as text
  const conversation = messages
    .map((m) => `${m.role === "user" ? "Visitor" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const userPrompt =
    `Here is a conversation between a visitor and an AI assistant:\n\n${conversation}\n\n` +
    `Please generate a structured summary report of this conversation.`;

  // Mock mode: return a simple summary
  if (mock.enabled) {
    console.log("[report] mock mode, returning mock summary");
    await new Promise((r) => setTimeout(r, mock.delayMs));
    return "## Overview\n\nThis is a mock conversation report.\n\n## Key Topics Discussed\n\n- Topic 1\n- Topic 2\n\n## Key Takeaways\n\n- Takeaway 1\n- Takeaway 2";
  }

  console.log("[report] generating summary via Agent SDK");

  let result = "";
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: summaryPrompt,
      maxTurns: 1,
      allowedTools: [],
    } as any,
  })) {
    const msg = message as any;
    if (msg.type === "result" && msg.result) {
      result = msg.result;
    }
  }

  return result;
}
