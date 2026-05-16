import { test, expect } from "@playwright/test";
import { GatewayClient } from "../fixtures/gateway-client.js";

/**
 * IM Bridge tests with real AI.
 * Validates behavior that requires actual Claude responses,
 * including /summary skill handling.
 */

const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
const GATEWAY_URL = process.env.GATEWAY_URL || "ws://gateway:8001";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

/** Create an invite via Django API, optionally with skill IDs. */
async function createInvite(
  label: string,
  options?: { skill_ids?: string[]; greeting?: string },
): Promise<string> {
  const body: Record<string, unknown> = {
    label,
    greeting: options?.greeting ?? "Welcome! How can I help you?",
  };
  if (options?.skill_ids) body.skill_ids = options.skill_ids;

  const res = await fetch(`${DJANGO_URL}/api/invites/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OWNER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  const invite = await res.json();
  return invite.code;
}

/** Find the "Conversation Report" skill ID. */
async function getReportSkillId(): Promise<string | undefined> {
  const res = await fetch(`${DJANGO_URL}/api/skills/`, {
    headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
  });
  expect(res.ok).toBe(true);
  const skills = await res.json();
  const reportSkill = skills.find(
    (s: { name: string }) => s.name === "Conversation Report",
  );
  return reportSkill?.id;
}

test.describe("IM Bridge: real AI conversation", () => {
  test("basic conversation produces non-empty response", async () => {
    const code = await createInvite("im-bridge-ai-basic");

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);
      expect(auth.success).toBe(true);
      await greetingPromise;

      const reply = await client.sendMessage(
        "Hello, what can you tell me?",
      );
      expect(reply.length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });
});

test.describe("IM Bridge: /summary skill", () => {
  test("/summary should not return 'Unknown skill'", async () => {
    const reportSkillId = await getReportSkillId();
    // Skip if the skill doesn't exist in this environment
    test.skip(!reportSkillId, "Conversation Report skill not found");

    const code = await createInvite("im-bridge-summary-test", {
      skill_ids: [reportSkillId!],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);
      expect(auth.success).toBe(true);
      await greetingPromise;

      // Have a brief conversation first so there's something to summarize
      await client.sendMessage("Tell me about yourself");
      await client.sendMessage("What are your main skills?");

      // Now send /summary
      const summaryReply = await client.sendMessage("/summary");
      expect(summaryReply.toLowerCase()).not.toContain("unknown skill");
      expect(summaryReply.length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });
});
