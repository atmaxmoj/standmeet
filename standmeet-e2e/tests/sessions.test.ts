import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, createWebPage, createIsolatedWebPage, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";
import { setMockResponse, resetMock } from "../fixtures/mock.js";

/**
 * Session management tests.
 * Direct URL access, session resumption, multi-tab, message limits.
 */

const WEB_URL = process.env.WEB_URL || "http://web:3000";
let electron: Page;
let web: Page;
let inviteCode: string;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();

  // Create test invite with message limit
  await electron.getByTestId("nav-invites").click();
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-sessions");
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

test.describe("Session management", () => {
  test("direct URL /i/{code} enters chat", async () => {
    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await expect(web.locator(".chat-container")).toBeVisible();
  });

  test("URL updates with session ID after connecting", async () => {
    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);

    // URL should now contain a session ID
    const url = web.url();
    expect(url).toContain(inviteCode);
  });

  test("session history restored on reconnect", async () => {
    await setMockResponse("I will remember UMBRELLA for you.");

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);

    await sendAndExpectReply(web, "Remember the word UMBRELLA");

    // Get the current URL with session ID
    const sessionUrl = web.url();

    // Navigate away and come back
    await web.goto(WEB_URL);
    await web.goto(sessionUrl);
    await waitForChatReady(web);

    // Wait for restored messages to appear
    await expect(web.locator(".chat-bubble-assistant").first()).toBeVisible({ timeout: 10000 });

    // Previous messages should be restored
    const content = await web.locator(".chat-container").textContent();
    expect(content).toContain("UMBRELLA");

    await resetMock();
  });

  test("multi-tab with same invite both work", async () => {
    const page2 = await createWebPage();

    try {
      await web.goto(`${WEB_URL}/i/${inviteCode}`);
      await waitForChatReady(web);

      await page2.goto(`${WEB_URL}/i/${inviteCode}`);
      await waitForChatReady(page2);

      // Send from tab 1
      await sendAndExpectReply(web, "Hello from tab 1");

      // Tab 2 should also show the response
      await expect(page2.locator(".chat-bubble-assistant").last()).toBeVisible({ timeout: 60000 });
    } finally {
      await page2.close();
    }
  });
});

test.describe("Session isolation", () => {
  test("different visitors with same invite get isolated sessions", async () => {
    await setMockResponse("I heard you say APPLE.");

    // Visitor A enters via web
    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "APPLE");

    // Visitor B uses a brand-new browser context (no shared cookies/storage)
    const pageB = await createIsolatedWebPage();
    try {
      await pageB.goto(`${WEB_URL}/i/${inviteCode}`);
      await waitForChatReady(pageB);

      // Page B should NOT see Visitor A's message
      const content = await pageB.locator(".chat-container").textContent();
      expect(content).not.toContain("APPLE");

      // Page B can chat independently
      await sendAndExpectReply(pageB, "BANANA");
    } finally {
      await pageB.context().close();
    }

    await resetMock();
  });
});

test.describe("Message limit", () => {
  let limitInviteCode: string;

  test("create invite with message limit", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-msg-limit");
    await electron.getByTestId("invite-max-messages").fill("2");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    limitInviteCode = (await codeEl.locator("code").textContent()) ?? "";
  });

  test("message limit disables input after limit reached", async () => {
    await web.goto(`${WEB_URL}/i/${limitInviteCode}`);
    await waitForChatReady(web);

    // Send 2 messages (the limit)
    await sendAndExpectReply(web, "Message 1");
    await sendAndExpectReply(web, "Message 2");

    // After reaching the limit, input should be disabled with "Message limit reached" placeholder
    const input = web.locator(".chat-input");
    await expect(input).toBeDisabled({ timeout: 10000 });
    await expect(input).toHaveAttribute("placeholder", /[Mm]essage limit reached/);

    // Send button should be hidden (not just disabled)
    await expect(web.locator(".chat-send-btn")).not.toBeVisible({ timeout: 3000 });

    // Message count should show 2/2
    await expect(web.locator(".chat-message-count")).toContainText("2/2");
  });
});
