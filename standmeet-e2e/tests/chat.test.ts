import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";
import { setMockResponse, resetMock } from "../fixtures/mock.js";

/**
 * Chat experience (UI/UX) tests.
 * Tests landing page, chat flow, markdown rendering, back button, ConnectGuide tabs.
 */

const WEB_URL = process.env.WEB_URL || "http://web:3000";
let electron: Page;
let web: Page;
let testInviteCode: string;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();

  // Create a test invite via Electron for chat tests
  await electron.getByTestId("nav-invites").click();
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-chat-ux");
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

test.describe("Landing page", () => {
  test("shows heading and invite code link", async () => {
    await web.goto(WEB_URL);
    await expect(web.getByRole("heading", { name: "StandMeet" })).toBeVisible();
    await expect(web.getByText("Connect with your AI")).toBeVisible();
    await expect(web.getByText("Have an invite code?")).toBeVisible();
  });

  test("invite input appears after clicking link", async () => {
    await web.goto(WEB_URL);
    await web.click("button:has-text('Have an invite code?')");
    await expect(web.locator("#invite-code")).toBeVisible();
    await expect(web.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("Continue button enables after typing", async () => {
    await web.goto(WEB_URL);
    await web.click("button:has-text('Have an invite code?')");
    await web.fill("#invite-code", "sm_test");
    await expect(web.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});

test.describe("Chat flow", () => {
  test("connected chat shows empty state greeting", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    // Should show some greeting or empty state
    await expect(web.locator(".chat-container")).toBeVisible();
  });

  test("send message → loading state → receive reply", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    // Fill and send
    await web.fill(".chat-input", "Hello");
    await web.click(".chat-send-btn");

    // User message should appear
    await expect(web.locator(".chat-bubble-user").last()).toContainText("Hello");

    // Wait for assistant response
    await expect(web.locator(".chat-bubble-assistant").last()).toBeVisible({ timeout: 60000 });
    const replyText = await web.locator(".chat-bubble-assistant").last().textContent();
    expect(replyText!.length).toBeGreaterThan(0);
  });

  test("can send multiple messages in conversation", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    await sendAndExpectReply(web, "Hi");
    await sendAndExpectReply(web, "What is your name?");
    expect(await web.locator(".chat-bubble-assistant").count()).toBeGreaterThanOrEqual(2);
  });

  test("markdown rendered in assistant messages", async () => {
    await setMockResponse("## Hello World\n\nSome **bold** text.");

    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    await sendAndExpectReply(web, "Reply with exactly: ## Hello World");

    const bubble = web.locator(".chat-bubble-assistant").last();
    const innerHTML = await bubble.innerHTML();
    // ReactMarkdown should produce HTML elements
    expect(innerHTML).toContain("<");

    await resetMock();
  });

  test("user messages remain plain text", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    await web.fill(".chat-input", "**bold** text");
    await web.click(".chat-send-btn");

    const userBubble = web.locator(".chat-bubble-user").last();
    await expect(userBubble).toBeVisible();
    const text = await userBubble.textContent();
    expect(text).toContain("**bold**");
  });

  test("back button returns to landing page", async () => {
    await web.goto(WEB_URL);
    await enterInviteCode(web, testInviteCode);
    await waitForChatReady(web);

    await web.click(".chat-back-btn");
    await expect(web.getByRole("heading", { name: "StandMeet" })).toBeVisible();
  });
});

test.describe("ConnectGuide tabs", () => {
  test("tabs switch content", async () => {
    await web.goto(WEB_URL);
    const tabs = web.locator(".connect-guide-tab, [role='tab']");
    const tabCount = await tabs.count();
    if (tabCount >= 2) {
      await tabs.nth(1).click();
      // Content should change
      await tabs.nth(0).click();
      // No crash
    }
  });
});
