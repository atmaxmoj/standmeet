import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";
import { resetMock } from "../fixtures/mock.js";

/**
 * Security tests.
 * XSS prevention, error message friendliness, input validation.
 */

const WEB_URL = process.env.WEB_URL || "http://web:3000";
let electron: Page;
let web: Page;
let testInviteCode: string;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();

  // Create test invite
  await electron.getByTestId("nav-invites").click();
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-security");
  await electron.getByTestId("invite-create-btn").click();

  const codeEl = electron.getByTestId("invite-code");
  await codeEl.waitFor({ state: "visible", timeout: 10000 });
  testInviteCode = (await codeEl.locator("code").textContent()) ?? "";
});

test.afterAll(async () => {
  await resetMock().catch(() => {});
  await closeWeb();
  await closeElectron();
});

test.describe("Security", () => {
  test("invalid invite code shows form-level error", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, "sm_invalid_code_xyz");

    const errorEl = web.locator(".invite-error");
    await expect(errorEl).toBeVisible({ timeout: 15000 });
    // Should NOT enter the chat view
    await expect(web.locator(".chat-container")).not.toBeVisible();
    // Input should still be visible for retry
    await expect(web.locator("#invite-code")).toBeVisible();
  });

  test("error messages contain no technical details", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, "sm_nonexistent_code_123");

    const errorEl = web.locator(".invite-error");
    await expect(errorEl).toBeVisible({ timeout: 15000 });

    const errorText = (await errorEl.textContent()) ?? "";
    const forbidden = [
      "exited with code",
      "process",
      "ENOENT",
      "ECONNREFUSED",
      "stack",
      "Error:",
      "TypeError",
      "ReferenceError",
      "at ",
      "undefined",
      "null",
    ];
    for (const pattern of forbidden) {
      expect(errorText).not.toContain(pattern);
    }
  });

  test("XSS: script tags are escaped in chat messages", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    const xssPayload = '<script>alert("xss")</script>';
    await web.fill(".chat-input", xssPayload);
    await web.click(".chat-send-btn");

    // User message should show the raw script tag as text
    const userBubble = web.locator(".chat-bubble-user").last();
    await expect(userBubble).toBeVisible();

    const text = await userBubble.textContent();
    expect(text).toContain("<script>");

    // The script tag should NOT be rendered as HTML
    const innerHTML = await userBubble.innerHTML();
    expect(innerHTML).not.toContain("<script>");
    // It should be escaped
    expect(innerHTML).toContain("&lt;script&gt;");
  });

  test("emoji in user message is preserved", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    await web.fill(".chat-input", "Hello 🎉🚀");
    await web.click(".chat-send-btn");

    const userBubble = web.locator(".chat-bubble-user").last();
    await expect(userBubble).toBeVisible();
    const text = await userBubble.textContent();
    expect(text).toContain("🎉");
    expect(text).toContain("🚀");
  });

  test("send button disabled for empty/whitespace input", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    // Empty input
    await web.fill(".chat-input", "");
    const sendBtn = web.locator(".chat-send-btn");
    await expect(sendBtn).toBeDisabled();

    // Whitespace only
    await web.fill(".chat-input", "   ");
    await expect(sendBtn).toBeDisabled();
  });
});
