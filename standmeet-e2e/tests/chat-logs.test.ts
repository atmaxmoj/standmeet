import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";
import { resetMock } from "../fixtures/mock.js";

/**
 * Chat logs viewing.
 * Visitor chats → Owner views logs in Electron InviteDetail.
 * Chat logs are always visible (no toggle) and auto-load on mount.
 */

const WEB_URL = process.env.WEB_URL || "http://web:3000";
let electron: Page;
let web: Page;
let inviteCode: string;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();

  // Create test invite
  await electron.getByTestId("nav-invites").click();
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-chat-logs");
  await electron.getByTestId("invite-create-btn").click();

  const codeEl = electron.getByTestId("invite-code");
  await codeEl.waitFor({ state: "visible", timeout: 10000 });
  inviteCode = (await codeEl.locator("code").textContent()) ?? "";
});

test.afterAll(async () => {
  await resetMock().catch(() => {});
  await closeWeb();
  await closeElectron();
});

test.describe("Chat logs", () => {
  test("visitor sends messages via web chat", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, inviteCode);
    await waitForChatReady(web);

    await sendAndExpectReply(web, "Hello from e2e test");
    await sendAndExpectReply(web, "What is 2+2?");
  });

  test("owner can view chat logs in Electron", async () => {
    // Wait a bit for async log writes
    await new Promise((r) => setTimeout(r, 2000));

    // Navigate to the invite detail
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId(`invite-item-${inviteCode}`).click();

    // Refresh logs (component may have auto-loaded empty logs on first mount)
    const refreshBtn = electron.locator("button", { hasText: "Refresh" });
    await refreshBtn.waitFor({ state: "visible", timeout: 5000 });
    await refreshBtn.click();

    // Verify logs are visible and contain our messages
    const logItems = electron.locator(".chat-log-item");
    await expect(logItems.first()).toBeVisible({ timeout: 10000 });

    const logsCount = await logItems.count();
    expect(logsCount).toBeGreaterThanOrEqual(2);

    // Check that user messages are recorded
    const logText = await electron.locator(".chat-logs").textContent();
    expect(logText).toContain("Hello from e2e test");
    expect(logText).toContain("2+2");
  });

  test("chat logs are isolated between invites", async () => {
    // Create a second invite
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-chat-logs-2");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });

    // Logs auto-load — should show "No chat logs yet" or empty state
    await expect(electron.locator(".empty-message").or(electron.getByText("No chat logs"))).toBeVisible({
      timeout: 5000,
    });
  });
});
