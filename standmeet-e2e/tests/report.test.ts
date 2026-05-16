import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";
import { setMockResponse, resetMock } from "../fixtures/mock.js";

/**
 * Report generation tests.
 * Tests the "Conversation Report" feature:
 *   - Web: export button appears when skill is attached, generates PDF
 *   - Electron: Summarize button in chat logs
 *   - Gateway HTTP endpoint: POST /api/generate-report
 *
 * Requires builtin skills (especially "Conversation Report") to be seeded
 * in the test environment (see docker-compose.test.yml).
 */

const WEB_URL = process.env.WEB_URL || "http://web:3000";
const GATEWAY_URL = process.env.GATEWAY_URL || "ws://gateway:8001";
const GATEWAY_HTTP_URL = GATEWAY_URL.replace(/^ws/, "http");
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

let electron: Page;
let web: Page;
let inviteWithReport: string;
let inviteWithoutReport: string;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();

  // ── Create invite WITH "Conversation Report" skill attached ──
  await electron.getByTestId("nav-invites").click();
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-report-with");
  await electron.getByTestId("invite-create-btn").click();

  const codeEl = electron.getByTestId("invite-code");
  await codeEl.waitFor({ state: "visible", timeout: 10000 });
  inviteWithReport = (await codeEl.locator("code").textContent()) ?? "";

  // Attach "Conversation Report" skill via the skills dropdown
  const skillsToggle = electron.locator(".invite-skills-dropdown-toggle");
  await skillsToggle.waitFor({ state: "visible", timeout: 15000 });
  await skillsToggle.click();

  const reportSkillLabel = electron.locator("label.invite-skills-dropdown-item").filter({ hasText: "Conversation Report" });
  await reportSkillLabel.waitFor({ state: "visible", timeout: 10000 });
  await reportSkillLabel.click();

  // Close dropdown and verify skill count updated
  await skillsToggle.click();
  await expect(skillsToggle).toContainText("1 skill", { timeout: 5000 });

  // ── Create invite WITHOUT "Conversation Report" skill ──
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-report-without");
  await electron.getByTestId("invite-create-btn").click();

  const codeEl2 = electron.getByTestId("invite-code");
  await codeEl2.waitFor({ state: "visible", timeout: 10000 });
  inviteWithoutReport = (await codeEl2.locator("code").textContent()) ?? "";
});

test.afterAll(async () => {
  await resetMock().catch(() => {});
  await closeWeb();
  await closeElectron();
});

test.describe("Web: export button visibility", () => {
  test("export button appears when Conversation Report skill is attached", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, inviteWithReport);
    await waitForChatReady(web);

    // Send a message so there are messages in the session
    await sendAndExpectReply(web, "Hello for report test");

    // Export button should be visible
    await expect(web.locator(".chat-report-btn")).toBeVisible({ timeout: 10000 });
  });

  test("export button does NOT appear when skill is not attached", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, inviteWithoutReport);
    await waitForChatReady(web);

    await sendAndExpectReply(web, "Hello no report test");

    // Export button should NOT exist
    await expect(web.locator(".chat-report-btn")).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("Web: report generation flow", () => {
  test("clicking export triggers report, downloads PDF, then disables input", async () => {
    await setMockResponse("This is a mock reply");

    await web.goto(WEB_URL);
    await enterInviteCode(web, inviteWithReport);
    await waitForChatReady(web);

    await sendAndExpectReply(web, "Tell me about yourself");

    // Click export button
    const exportBtn = web.locator(".chat-report-btn");
    await expect(exportBtn).toBeVisible({ timeout: 10000 });

    // Listen for download event before clicking
    const downloadPromise = web.waitForEvent("download", { timeout: 60000 });
    await exportBtn.click();

    // Accept the custom confirmation modal
    await web.locator(".confirm-ok").click();

    // Wait for download
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^conversation-report-.*\.pdf$/);

    // After report: input should be disabled with "Conversation ended" placeholder
    const input = web.locator(".chat-input");
    await expect(input).toBeDisabled({ timeout: 10000 });
    await expect(input).toHaveAttribute("placeholder", /[Cc]onversation ended/);

    // Send button should be hidden
    await expect(web.locator(".chat-send-btn")).not.toBeVisible({ timeout: 3000 });

    // Download Summary button should be hidden
    await expect(web.locator(".chat-report-btn")).not.toBeVisible({ timeout: 3000 });

    await resetMock();
  });

  test("declining confirmation does NOT end session", async () => {
    // Need a fresh invite since the previous test ended the session for inviteWithReport
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-report-decline");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    const declineInvite = (await codeEl.locator("code").textContent()) ?? "";

    // Attach "Conversation Report" skill
    const skillsToggle = electron.locator(".invite-skills-dropdown-toggle");
    await skillsToggle.waitFor({ state: "visible", timeout: 15000 });
    await skillsToggle.click();
    const reportSkillLabel = electron.locator("label.invite-skills-dropdown-item").filter({ hasText: "Conversation Report" });
    await reportSkillLabel.waitFor({ state: "visible", timeout: 10000 });
    await reportSkillLabel.click();
    await skillsToggle.click();

    await setMockResponse("Mock reply for decline test");
    await web.goto(WEB_URL);
    await enterInviteCode(web, declineInvite);
    await waitForChatReady(web);

    await sendAndExpectReply(web, "Hello for decline test");

    const exportBtn = web.locator(".chat-report-btn");
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
    await exportBtn.click();

    // Decline the custom confirmation modal
    await web.locator(".confirm-cancel").click();

    // Input should still be enabled
    const input = web.locator(".chat-input");
    await expect(input).toBeEnabled({ timeout: 5000 });

    // Send button should still be visible
    await expect(web.locator(".chat-send-btn")).toBeVisible();

    // Download Summary button should still be visible
    await expect(exportBtn).toBeVisible();

    await resetMock();
  });
});

test.describe("Gateway HTTP: /api/generate-report", () => {
  test("returns summary with valid auth and messages", async () => {
    const res = await fetch(`${GATEWAY_HTTP_URL}/api/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OWNER_TOKEN}`,
      },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "What do you do?" },
          { role: "assistant", content: "I help people learn about the owner." },
        ],
        prompt: "Generate a summary.",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeTruthy();
    expect(typeof data.summary).toBe("string");
    expect(data.summary).toContain("##");
  });

  test("rejects unauthenticated requests", async () => {
    const res = await fetch(`${GATEWAY_HTTP_URL}/api/generate-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        prompt: "Summarize.",
      }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  test("rejects wrong token", async () => {
    const res = await fetch(`${GATEWAY_HTTP_URL}/api/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong_token",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        prompt: "Summarize.",
      }),
    });

    expect(res.status).toBe(401);
  });

  test("rejects missing messages", async () => {
    const res = await fetch(`${GATEWAY_HTTP_URL}/api/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OWNER_TOKEN}`,
      },
      body: JSON.stringify({ prompt: "Summarize." }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("required");
  });

  test("rejects missing prompt", async () => {
    const res = await fetch(`${GATEWAY_HTTP_URL}/api/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OWNER_TOKEN}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(res.status).toBe(400);
  });

  test("CORS preflight returns correct headers", async () => {
    const res = await fetch(`${GATEWAY_HTTP_URL}/api/generate-report`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  test("POST response includes CORS headers", async () => {
    const res = await fetch(`${GATEWAY_HTTP_URL}/api/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OWNER_TOKEN}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        prompt: "Summarize.",
      }),
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

test.describe("Electron: Summarize button in chat logs", () => {
  test("Summarize button appears for invite with report skill", async () => {
    // Chat logs already exist from the download test above.
    // Navigate to the invite detail in Electron
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId(`invite-item-${inviteWithReport}`).click();

    // Refresh logs
    const refreshBtn = electron.locator("button", { hasText: "Refresh" });
    await refreshBtn.waitFor({ state: "visible", timeout: 5000 });
    await refreshBtn.click();

    // Wait for log items to appear
    await expect(electron.locator(".chat-log-item").first()).toBeVisible({ timeout: 10000 });

    // Summarize button should be visible in the session header row
    await expect(electron.locator(".chat-log-summarize-btn").first()).toBeVisible({ timeout: 5000 });
  });

  test("Summarize button also appears for invite without report skill (owner can always summarize)", async () => {
    // Chat as visitor on the no-report invite
    await web.goto(WEB_URL);
    await enterInviteCode(web, inviteWithoutReport);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Hello no report summarize");

    // Wait for async log writes
    await new Promise((r) => setTimeout(r, 2000));

    // Navigate to the invite detail in Electron
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId(`invite-item-${inviteWithoutReport}`).click();

    // Refresh logs
    const refreshBtn = electron.locator("button", { hasText: "Refresh" });
    await refreshBtn.waitFor({ state: "visible", timeout: 5000 });
    await refreshBtn.click();

    // Wait for log items to appear
    await expect(electron.locator(".chat-log-item").first()).toBeVisible({ timeout: 10000 });

    // Summarize button should be visible — owner can summarize any invite's logs
    // as long as "Conversation Report" skill exists globally
    await expect(electron.locator(".chat-log-summarize-btn").first()).toBeVisible({ timeout: 5000 });
  });

  test("clicking Summarize shows two-column layout: narrower chat log + summary panel", async () => {
    // Navigate to the invite with report skill
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId(`invite-item-${inviteWithReport}`).click();

    // Refresh logs
    const refreshBtn = electron.locator("button", { hasText: "Refresh" });
    await refreshBtn.waitFor({ state: "visible", timeout: 5000 });
    await refreshBtn.click();

    // Wait for log items
    await expect(electron.locator(".chat-log-item").first()).toBeVisible({ timeout: 10000 });

    // Before clicking: session body should NOT have has-summary class
    const sessionBody = electron.locator(".chat-log-session-body").first();
    await expect(sessionBody).toBeVisible({ timeout: 5000 });
    await expect(sessionBody).not.toHaveClass(/has-summary/);

    // Click Summarize
    const summarizeBtn = electron.locator(".chat-log-summarize-btn").first();
    await summarizeBtn.click();

    // Wait for summary panel to appear on the right
    const summaryEl = electron.locator(".chat-log-summary").first();
    await expect(summaryEl).toBeVisible({ timeout: 30000 });

    // Session body should now have has-summary class (triggers two-column layout)
    await expect(sessionBody).toHaveClass(/has-summary/);

    // Summary panel should have header "Summary" and markdown content
    await expect(electron.locator(".chat-log-summary-header").first()).toContainText("Summary");
    const summaryContent = electron.locator(".chat-log-summary-content").first();
    const summaryText = await summaryContent.textContent();
    expect(summaryText!.length).toBeGreaterThan(10);

    // Chat log messages column should still be visible (narrower, but present)
    await expect(electron.locator(".chat-log-messages-col").first()).toBeVisible();

    // Summarize button should be gone (already summarized)
    await expect(electron.locator(".chat-log-summarize-btn")).not.toBeVisible({ timeout: 3000 });
  });

  test("summary persists after navigating away and back", async () => {
    // Previous test generated a summary. Wait for the async save to backend.
    await new Promise((r) => setTimeout(r, 2000));

    // Navigate away to a different section.
    await electron.getByTestId("nav-invites").click();

    // Wait for invite list to appear
    await electron.getByTestId(`invite-item-${inviteWithReport}`).waitFor({ state: "visible", timeout: 5000 });

    // Navigate back to the same invite
    await electron.getByTestId(`invite-item-${inviteWithReport}`).click();

    // Wait for chat logs to load (auto-expand should expand the session with summary)
    await expect(electron.locator(".chat-log-item").first()).toBeVisible({ timeout: 10000 });

    // Summary should be visible — loaded from persisted data, session auto-expanded
    const summaryEl = electron.locator(".chat-log-summary").first();
    await expect(summaryEl).toBeVisible({ timeout: 10000 });

    // Summary content should still have meaningful text
    const summaryContent = electron.locator(".chat-log-summary-content").first();
    const summaryText = await summaryContent.textContent();
    expect(summaryText!.length).toBeGreaterThan(10);

    // Summarize button should NOT appear (summary already exists)
    await expect(electron.locator(".chat-log-summarize-btn")).not.toBeVisible({ timeout: 3000 });
  });

  test("Resummarize button regenerates summary", async () => {
    // At this point, the session already has a persisted summary from previous tests.
    // The summary panel should be visible with a Resummarize button.
    const summaryEl = electron.locator(".chat-log-summary").first();
    await expect(summaryEl).toBeVisible({ timeout: 10000 });

    // Resummarize button should be visible inside the summary panel
    const resummarizeBtn = electron.locator(".chat-log-resummarize-btn").first();
    await expect(resummarizeBtn).toBeVisible({ timeout: 5000 });

    // Remember old summary text
    const oldText = await electron.locator(".chat-log-summary-content").first().textContent();

    // Click Resummarize
    await resummarizeBtn.click();

    // Should show generating state
    await expect(electron.locator(".chat-log-generating")).toBeVisible({ timeout: 3000 });

    // Wait for new summary to appear
    await expect(summaryEl).toBeVisible({ timeout: 30000 });

    // New summary should have content
    const newText = await electron.locator(".chat-log-summary-content").first().textContent();
    expect(newText!.length).toBeGreaterThan(10);

    // The original Summarize button should still NOT appear
    await expect(electron.locator(".chat-log-summarize-btn")).not.toBeVisible({ timeout: 3000 });
  });
});
