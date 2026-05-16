import { test, expect } from "@playwright/test";
import { GatewayClient } from "../fixtures/gateway-client.js";
import { setMockResponse, resetMock, evictAllSessions } from "../fixtures/mock.js";

/**
 * IM Bridge protocol tests (mock AI).
 * Validates the WebSocket protocol that IM bots use to talk to Gateway:
 * connect → authenticate → sendMessage → receive response.
 */

const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
const GATEWAY_URL = process.env.GATEWAY_URL || "ws://gateway:8001";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

/** Create an invite via Django API and return the code. */
async function createInvite(label: string, options?: { greeting?: string; skill_ids?: string[] }): Promise<string> {
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
  expect(invite.code).toMatch(/^sm_/);
  return invite.code;
}

test.afterAll(async () => {
  await resetMock().catch(() => {});
});

test.describe("IM Bridge: authentication", () => {
  test("valid invite code authenticates and receives greeting", async () => {
    const code = await createInvite("im-bridge-auth-test");

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      expect(client.connected).toBe(true);

      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);

      expect(auth.success).toBe(true);
      expect(auth.sessionId).toBeTruthy();

      const greeting = await greetingPromise;
      expect(greeting.length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  test("invalid invite code returns auth_error", async () => {
    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);

      const auth = await client.authenticate("sm_invalid_nonexistent_xxx");
      expect(auth.success).toBe(false);
      expect(auth.error).toBeTruthy();
    } finally {
      client.close();
    }
  });
});

test.describe("IM Bridge: messaging", () => {
  let inviteCode: string;

  test.beforeAll(async () => {
    inviteCode = await createInvite("im-bridge-msg-test");
  });

  test("send message and receive mock response", async () => {
    await setMockResponse("Hello from mock AI");

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(inviteCode);
      expect(auth.success).toBe(true);
      await greetingPromise;

      const reply = await client.sendMessage("Hi there");
      expect(reply).toBe("Hello from mock AI");
    } finally {
      client.close();
    }
  });

  test("multiple messages in sequence", async () => {
    await setMockResponse("Response 1");
    const code = await createInvite("im-bridge-multi-msg");

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      await client.authenticate(code);
      await greetingPromise;

      const reply1 = await client.sendMessage("First message");
      expect(reply1).toBe("Response 1");

      await setMockResponse("Response 2");
      const reply2 = await client.sendMessage("Second message");
      expect(reply2).toBe("Response 2");
    } finally {
      client.close();
    }
  });
});

/** Fetch all skills and return a map of name → id. */
async function getSkillMap(): Promise<Record<string, string>> {
  const res = await fetch(`${DJANGO_URL}/api/skills/`, {
    headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
  });
  expect(res.ok).toBe(true);
  const skills: { name: string; id: string }[] = await res.json();
  return Object.fromEntries(skills.map((s) => [s.name, s.id]));
}

/** PATCH an invite to change its skill_ids. */
async function updateInviteSkills(code: string, skill_ids: string[]): Promise<void> {
  const res = await fetch(`${DJANGO_URL}/api/invites/${code}/`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${OWNER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ skill_ids }),
  });
  expect(res.ok).toBe(true);
}

/** Find an invite by code from the list endpoint and return its detail. */
async function getInvite(code: string): Promise<{ skill_ids: string[]; [k: string]: unknown }> {
  const res = await fetch(`${DJANGO_URL}/api/invites/`, {
    headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
  });
  expect(res.ok).toBe(true);
  const invites: { code: string; skill_ids: string[] }[] = await res.json();
  const invite = invites.find((i) => i.code === code);
  expect(invite).toBeTruthy();
  return invite!;
}

/** Call session-init internal API for an invite and return the skills array. */
async function getSessionInitSkills(code: string): Promise<{ name: string; prompt: string }[]> {
  const res = await fetch(`${DJANGO_URL}/api/internal/session-init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OWNER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ invite_code: code, preview: true }),
  });
  expect(res.ok).toBe(true);
  const data = await res.json();
  return data.skills;
}

test.describe("IM Bridge: skill assignment per invite", () => {
  test("create invite with no skills → skill_ids is empty", async () => {
    const code = await createInvite("im-skill-none");
    const invite = await getInvite(code);
    expect(invite.skill_ids).toEqual([]);

    const initSkills = await getSessionInitSkills(code);
    expect(initSkills).toEqual([]);
  });

  test("create invite with one skill → skill_ids and session-init reflect it", async () => {
    const skills = await getSkillMap();
    const skillName = Object.keys(skills)[0];
    test.skip(!skillName, "No skills available");

    const code = await createInvite("im-skill-one", {
      skill_ids: [skills[skillName]],
    });

    const invite = await getInvite(code);
    expect(invite.skill_ids).toEqual([skills[skillName]]);

    const initSkills = await getSessionInitSkills(code);
    expect(initSkills).toHaveLength(1);
    expect(initSkills[0].name).toBe(skillName);
    expect(initSkills[0].prompt.length).toBeGreaterThan(0);
  });

  test("create invite with multiple skills → all are attached", async () => {
    const skills = await getSkillMap();
    const names = Object.keys(skills);
    test.skip(names.length < 3, "Need at least 3 skills");

    const threeIds = names.slice(0, 3).map((n) => skills[n]);
    const code = await createInvite("im-skill-multi", {
      skill_ids: threeIds,
    });

    const invite = await getInvite(code);
    expect(invite.skill_ids).toHaveLength(3);
    for (const id of threeIds) {
      expect(invite.skill_ids).toContain(id);
    }

    const initSkills = await getSessionInitSkills(code);
    expect(initSkills).toHaveLength(3);
    const initNames = initSkills.map((s) => s.name);
    for (const name of names.slice(0, 3)) {
      expect(initNames).toContain(name);
    }
  });

  test("PATCH to add a skill → GET and session-init reflect it", async () => {
    const skills = await getSkillMap();
    const skillName = Object.keys(skills)[0];
    test.skip(!skillName, "No skills available");

    const code = await createInvite("im-skill-patch-add");

    // Initially no skills
    let invite = await getInvite(code);
    expect(invite.skill_ids).toEqual([]);

    // Add a skill
    await updateInviteSkills(code, [skills[skillName]]);

    invite = await getInvite(code);
    expect(invite.skill_ids).toEqual([skills[skillName]]);

    const initSkills = await getSessionInitSkills(code);
    expect(initSkills).toHaveLength(1);
    expect(initSkills[0].name).toBe(skillName);
  });

  test("PATCH to swap skills → old skill removed, new skill present", async () => {
    const skills = await getSkillMap();
    const names = Object.keys(skills);
    test.skip(names.length < 2, "Need at least 2 skills");

    const code = await createInvite("im-skill-patch-swap", {
      skill_ids: [skills[names[0]]],
    });

    // Initially has skill A
    let initSkills = await getSessionInitSkills(code);
    expect(initSkills).toHaveLength(1);
    expect(initSkills[0].name).toBe(names[0]);

    // Swap to skill B
    await updateInviteSkills(code, [skills[names[1]]]);

    initSkills = await getSessionInitSkills(code);
    expect(initSkills).toHaveLength(1);
    expect(initSkills[0].name).toBe(names[1]);
  });

  test("PATCH to remove all skills → empty", async () => {
    const skills = await getSkillMap();
    const skillName = Object.keys(skills)[0];
    test.skip(!skillName, "No skills available");

    const code = await createInvite("im-skill-patch-clear", {
      skill_ids: [skills[skillName]],
    });

    let initSkills = await getSessionInitSkills(code);
    expect(initSkills).toHaveLength(1);

    await updateInviteSkills(code, []);

    initSkills = await getSessionInitSkills(code);
    expect(initSkills).toEqual([]);
  });

  test("two invites with different skill sets are independent", async () => {
    const skills = await getSkillMap();
    const names = Object.keys(skills);
    test.skip(names.length < 2, "Need at least 2 skills");

    const codeA = await createInvite("im-skill-iso-A", {
      skill_ids: [skills[names[0]]],
    });
    const codeB = await createInvite("im-skill-iso-B", {
      skill_ids: [skills[names[1]]],
    });

    const initA = await getSessionInitSkills(codeA);
    const initB = await getSessionInitSkills(codeB);

    expect(initA).toHaveLength(1);
    expect(initA[0].name).toBe(names[0]);

    expect(initB).toHaveLength(1);
    expect(initB[0].name).toBe(names[1]);

    // Modifying A does not affect B
    await updateInviteSkills(codeA, [skills[names[0]], skills[names[1]]]);
    const initA2 = await getSessionInitSkills(codeA);
    const initB2 = await getSessionInitSkills(codeB);
    expect(initA2).toHaveLength(2);
    expect(initB2).toHaveLength(1); // unchanged
  });
});

test.describe("IM Bridge: dynamic skill capabilities", () => {
  test("invite with report skill → auth_ok has canGenerateReport: true", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    const code = await createInvite("im-cap-with-report", {
      skill_ids: [skills["Conversation Report"]],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);
      await greetingPromise;

      expect(auth.success).toBe(true);
      expect(auth.capabilities?.canGenerateReport).toBe(true);
    } finally {
      client.close();
    }
  });

  test("invite without report skill → auth_ok has canGenerateReport: false", async () => {
    const code = await createInvite("im-cap-no-report");

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);
      await greetingPromise;

      expect(auth.success).toBe(true);
      expect(auth.capabilities?.canGenerateReport).toBe(false);
    } finally {
      client.close();
    }
  });

  test("invite with non-report skills → canGenerateReport: false", async () => {
    const skills = await getSkillMap();
    // Pick any built-in skill that is NOT Conversation Report
    const otherSkillName = Object.keys(skills).find((n) => n !== "Conversation Report");
    test.skip(!otherSkillName, "No non-report skills found");

    const code = await createInvite("im-cap-other-skill", {
      skill_ids: [skills[otherSkillName!]],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);
      await greetingPromise;

      expect(auth.success).toBe(true);
      // Has a skill, but not the report skill
      expect(auth.capabilities?.canGenerateReport).toBe(false);
    } finally {
      client.close();
    }
  });

  test("invite with multiple skills including report → canGenerateReport: true", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");
    const otherSkillName = Object.keys(skills).find((n) => n !== "Conversation Report");
    test.skip(!otherSkillName, "No non-report skills found");

    const code = await createInvite("im-cap-multi-skill", {
      skill_ids: [skills[otherSkillName!], skills["Conversation Report"]],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);
      await greetingPromise;

      expect(auth.success).toBe(true);
      expect(auth.capabilities?.canGenerateReport).toBe(true);
    } finally {
      client.close();
    }
  });

  test("two invites with different skill sets → different capabilities", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    const codeWith = await createInvite("im-cap-diff-A", {
      skill_ids: [skills["Conversation Report"]],
    });
    const codeWithout = await createInvite("im-cap-diff-B");

    const clientA = new GatewayClient();
    const clientB = new GatewayClient();
    try {
      await clientA.connect(GATEWAY_URL);
      const gA = clientA.waitGreeting();
      const authA = await clientA.authenticate(codeWith);
      await gA;

      await clientB.connect(GATEWAY_URL);
      const gB = clientB.waitGreeting();
      const authB = await clientB.authenticate(codeWithout);
      await gB;

      expect(authA.capabilities?.canGenerateReport).toBe(true);
      expect(authB.capabilities?.canGenerateReport).toBe(false);
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  test("PATCH invite to add report skill → new connection picks up capability", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    // Create invite WITHOUT report skill
    const code = await createInvite("im-cap-patch");

    const client1 = new GatewayClient();
    try {
      await client1.connect(GATEWAY_URL);
      const g1 = client1.waitGreeting();
      const auth1 = await client1.authenticate(code);
      await g1;
      expect(auth1.capabilities?.canGenerateReport).toBe(false);
    } finally {
      client1.close();
    }

    // PATCH to add report skill
    await updateInviteSkills(code, [skills["Conversation Report"]]);

    // Evict in-memory session so reconnect creates a fresh one
    await evictAllSessions();

    // New connection should see updated capabilities
    const client2 = new GatewayClient();
    try {
      await client2.connect(GATEWAY_URL);
      const g2 = client2.waitGreeting();
      const auth2 = await client2.authenticate(code);
      await g2;
      expect(auth2.capabilities?.canGenerateReport).toBe(true);
    } finally {
      client2.close();
    }
  });

  test("PATCH invite to remove report skill → new connection loses capability", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    // Create invite WITH report skill
    const code = await createInvite("im-cap-patch-remove", {
      skill_ids: [skills["Conversation Report"]],
    });

    const client1 = new GatewayClient();
    try {
      await client1.connect(GATEWAY_URL);
      const g1 = client1.waitGreeting();
      const auth1 = await client1.authenticate(code);
      await g1;
      expect(auth1.capabilities?.canGenerateReport).toBe(true);
    } finally {
      client1.close();
    }

    // PATCH to remove report skill
    await updateInviteSkills(code, []);

    // Evict in-memory session so reconnect creates a fresh one
    await evictAllSessions();

    // New connection should lose capability
    const client2 = new GatewayClient();
    try {
      await client2.connect(GATEWAY_URL);
      const g2 = client2.waitGreeting();
      const auth2 = await client2.authenticate(code);
      await g2;
      expect(auth2.capabilities?.canGenerateReport).toBe(false);
    } finally {
      client2.close();
    }
  });
});

test.describe("IM Bridge: /summary command", () => {
  test("/summary with report skill returns mock summary", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    await setMockResponse("Mock AI response");
    const code = await createInvite("im-summary-with", {
      skill_ids: [skills["Conversation Report"]],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      await client.authenticate(code);
      await greetingPromise;

      // Have a conversation first
      await client.sendMessage("Hello");

      // /summary should be intercepted — returns mock summary, not mock AI response
      const reply = await client.sendMessage("/summary");
      expect(reply).toContain("##");
      expect(reply).not.toBe("Mock AI response");
    } finally {
      client.close();
    }
  });

  test("/summary without report skill returns friendly not-available message", async () => {
    await setMockResponse("Mock AI response");
    const code = await createInvite("im-summary-without");

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      await client.authenticate(code);
      await greetingPromise;

      const reply = await client.sendMessage("/summary");
      // Should NOT pass through to mock AI
      expect(reply).not.toBe("Mock AI response");
      expect(reply.length).toBeGreaterThan(0);
      expect(reply.toLowerCase()).not.toContain("unknown skill");
    } finally {
      client.close();
    }
  });

  test("/summary with no conversation history returns no-messages message", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    await setMockResponse("Mock AI response");
    const code = await createInvite("im-summary-empty", {
      skill_ids: [skills["Conversation Report"]],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      await client.authenticate(code);
      await greetingPromise;

      // /summary immediately — no user messages yet
      const reply = await client.sendMessage("/summary");
      expect(reply.length).toBeGreaterThan(0);
      // Should NOT contain markdown summary headers
      expect(reply).not.toContain("##");
    } finally {
      client.close();
    }
  });

  test("/summary twice — second attempt errors because session ended", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    await setMockResponse("Mock AI response");
    const code = await createInvite("im-summary-twice", {
      skill_ids: [skills["Conversation Report"]],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      await client.authenticate(code);
      await greetingPromise;

      await client.sendMessage("Hello");

      // First /summary succeeds
      const reply = await client.sendMessage("/summary");
      expect(reply).toContain("##");

      // Second /summary should fail — session is ended
      await expect(client.sendMessage("/summary")).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  test("regular messages still blocked after /summary ends session", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    await setMockResponse("Mock AI response");
    const code = await createInvite("im-summary-blocked", {
      skill_ids: [skills["Conversation Report"]],
    });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      await client.authenticate(code);
      await greetingPromise;

      await client.sendMessage("Hello");
      await client.sendMessage("/summary");

      // Regular messages should also fail after session ended
      await expect(client.sendMessage("Another question")).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  test("concurrent invites: /summary on one does not affect the other", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    await setMockResponse("Mock AI response");
    const codeA = await createInvite("im-summary-iso-A", {
      skill_ids: [skills["Conversation Report"]],
    });
    const codeB = await createInvite("im-summary-iso-B", {
      skill_ids: [skills["Conversation Report"]],
    });

    const clientA = new GatewayClient();
    const clientB = new GatewayClient();
    try {
      await clientA.connect(GATEWAY_URL);
      const gA = clientA.waitGreeting();
      await clientA.authenticate(codeA);
      await gA;

      await clientB.connect(GATEWAY_URL);
      const gB = clientB.waitGreeting();
      await clientB.authenticate(codeB);
      await gB;

      await clientA.sendMessage("Hello from A");
      await clientB.sendMessage("Hello from B");

      // End session A via /summary
      const summaryA = await clientA.sendMessage("/summary");
      expect(summaryA).toContain("##");

      // Session B should still be alive
      const replyB = await clientB.sendMessage("Still chatting");
      expect(replyB).toBe("Mock AI response");

      // Session B can also /summary independently
      const summaryB = await clientB.sendMessage("/summary");
      expect(summaryB).toContain("##");
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  test("PATCH to add report skill → /summary works on new session", async () => {
    const skills = await getSkillMap();
    test.skip(!skills["Conversation Report"], "Conversation Report skill not found");

    await setMockResponse("Mock AI response");
    // Create invite WITHOUT report skill
    const code = await createInvite("im-summary-patch-add");

    // First session: /summary returns "not available"
    const client1 = new GatewayClient();
    try {
      await client1.connect(GATEWAY_URL);
      const g1 = client1.waitGreeting();
      await client1.authenticate(code);
      await g1;

      const reply = await client1.sendMessage("/summary");
      expect(reply).not.toContain("##");
    } finally {
      client1.close();
    }

    // Owner adds report skill to this invite
    await updateInviteSkills(code, [skills["Conversation Report"]]);

    // Evict in-memory session so reconnect creates a fresh one
    await evictAllSessions();

    // New session: /summary now works
    const client2 = new GatewayClient();
    try {
      await client2.connect(GATEWAY_URL);
      const g2 = client2.waitGreeting();
      await client2.authenticate(code);
      await g2;

      await client2.sendMessage("Hello");
      const summary = await client2.sendMessage("/summary");
      expect(summary).toContain("##");
    } finally {
      client2.close();
    }
  });
});

test.describe("IM Bridge: session isolation", () => {
  test("two clients with different invites get independent sessions", async () => {
    const code1 = await createInvite("im-bridge-iso-1");
    const code2 = await createInvite("im-bridge-iso-2");
    await setMockResponse("Isolated response");

    const client1 = new GatewayClient();
    const client2 = new GatewayClient();

    try {
      // Connect and auth both clients with different invite codes
      await client1.connect(GATEWAY_URL);
      const greeting1 = client1.waitGreeting();
      const auth1 = await client1.authenticate(code1);
      expect(auth1.success).toBe(true);
      await greeting1;

      await client2.connect(GATEWAY_URL);
      const greeting2 = client2.waitGreeting();
      const auth2 = await client2.authenticate(code2);
      expect(auth2.success).toBe(true);
      await greeting2;

      // Different session IDs
      expect(auth1.sessionId).not.toBe(auth2.sessionId);

      // Both should get independent responses
      const reply1 = await client1.sendMessage("From client 1");
      expect(reply1).toBe("Isolated response");

      const reply2 = await client2.sendMessage("From client 2");
      expect(reply2).toBe("Isolated response");
    } finally {
      client1.close();
      client2.close();
    }
  });
});

test.describe("IM Bridge: sources in message_done", () => {
  let inviteCode: string;

  test.beforeAll(async () => {
    inviteCode = await createInvite("im-bridge-sources-test");
  });

  test("message_done includes sources when mock sets them", async () => {
    const mockSources = ["/profile/about", "/projects/standmeet"];
    await setMockResponse("Here is info about me.", { sources: mockSources });

    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(inviteCode);
      expect(auth.success).toBe(true);
      await greetingPromise;

      const reply = await client.sendMessage("Tell me about yourself");
      expect(reply).toBe("Here is info about me.");
      expect(client.lastSources).toEqual(mockSources);
    } finally {
      client.close();
    }
  });

  test("message_done has no sources when mock has none", async () => {
    await setMockResponse("Just a plain response");

    const code = await createInvite("im-bridge-no-sources");
    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      const auth = await client.authenticate(code);
      expect(auth.success).toBe(true);
      await greetingPromise;

      const reply = await client.sendMessage("Hello");
      expect(reply).toBe("Just a plain response");
      expect(client.lastSources).toBeUndefined();
    } finally {
      client.close();
    }
  });

  test("sources change between messages", async () => {
    await setMockResponse("First answer", { sources: ["/profile/about"] });

    const code = await createInvite("im-bridge-sources-change");
    const client = new GatewayClient();
    try {
      await client.connect(GATEWAY_URL);
      const greetingPromise = client.waitGreeting();
      await client.authenticate(code);
      await greetingPromise;

      await client.sendMessage("Question 1");
      expect(client.lastSources).toEqual(["/profile/about"]);

      // Second message with different sources
      await setMockResponse("Second answer", { sources: ["/projects/standmeet", "/experience/work"] });
      await client.sendMessage("Question 2");
      expect(client.lastSources).toEqual(["/projects/standmeet", "/experience/work"]);

      // Third message with no sources
      await setMockResponse("Third answer");
      await client.sendMessage("Question 3");
      expect(client.lastSources).toBeUndefined();
    } finally {
      client.close();
    }
  });
});

test.describe("IM Bridge: content fetch by path", () => {
  test("GET /api/repo/{path}/ returns content entry", async () => {
    // Create content first
    const contentPath = "/test/im-bridge-content-fetch";
    const contentBody = {
      path: contentPath,
      content: { text: "Hello from content fetch test" },
      summary: "Test summary for content fetch",
      content_type: "application/json",
      visibility: "public",
    };

    const createRes = await fetch(`${DJANGO_URL}/api/repo/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contentBody),
    });
    expect(createRes.ok).toBe(true);

    // Fetch it back by path (same API that content-fetcher.ts uses)
    const fetchRes = await fetch(`${DJANGO_URL}/api/repo/test/im-bridge-content-fetch/`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(fetchRes.ok).toBe(true);

    const data = await fetchRes.json();
    expect(data.path).toBe(contentPath);
    expect(data.summary).toBe("Test summary for content fetch");
    expect(data.content).toEqual({ text: "Hello from content fetch test" });
  });

  test("GET /api/repo/{path}/ returns 404 for nonexistent path", async () => {
    const fetchRes = await fetch(`${DJANGO_URL}/api/repo/nonexistent/path/that/does/not/exist/`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(fetchRes.status).toBe(404);
  });
});
