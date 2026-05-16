import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";
import { setMockResponse, resetMock } from "../fixtures/mock.js";

/**
 * UI layout tests — verify actual element POSITIONS on screen.
 * No CSS property checks. Only pixel positions via boundingBox.
 * If input bar is not at the bottom of the viewport, the test fails.
 */

const WEB_URL = process.env.WEB_URL || "http://web:3000";
let electron: Page;
let web: Page;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();
});

test.afterAll(async () => {
  await resetMock().catch(() => {});
  await closeWeb();
  await closeElectron();
});

/**
 * Assert layout by checking actual pixel positions only.
 * 1. Input bar must be at the bottom of the viewport
 * 2. Chat page must fill the entire viewport height
 * 3. Chat input must be visible
 */
async function assertChatLayout(page: Page) {
  const viewport = page.viewportSize()!;

  // Get actual positions of elements on screen
  const chatPageBox = await page.locator(".chat-page").boundingBox();
  expect(chatPageBox, ".chat-page must exist and be visible").not.toBeNull();

  const inputBarBox = await page.locator(".chat-input-bar").boundingBox();
  expect(inputBarBox, ".chat-input-bar must exist and be visible").not.toBeNull();

  // 1. Chat page must start at top and fill viewport
  expect(chatPageBox!.y, ".chat-page must start at top of viewport").toBeLessThanOrEqual(2);
  expect(chatPageBox!.height, ".chat-page must fill viewport height").toBeGreaterThanOrEqual(viewport.height - 2);

  // 2. Input bar bottom edge must be at viewport bottom (within 5px)
  const inputBarBottom = inputBarBox!.y + inputBarBox!.height;
  expect(inputBarBottom, "Input bar must be at bottom of viewport").toBeGreaterThanOrEqual(viewport.height - 5);

  // 3. Input bar must NOT be in the top half of the viewport (catches the "everything goes to top" bug)
  expect(inputBarBox!.y, "Input bar must not be in top half of viewport").toBeGreaterThan(viewport.height / 2);

  // 4. .chat-page must never be scrolled (scrollIntoView bug: propagates scroll to parent)
  const chatPageScrollTop = await page.evaluate(() => {
    const el = document.querySelector(".chat-page");
    return el ? el.scrollTop : 0;
  });
  expect(chatPageScrollTop, ".chat-page must not be scrolled").toBe(0);

  // 5. Chat input must be visible
  await expect(page.locator(".chat-input")).toBeVisible();
}

test.describe("Chat layout fills viewport", () => {
  test("normal chat state", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-layout-normal");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    const code = (await codeEl.locator("code").textContent()) ?? "";

    await web.goto(`${WEB_URL}/i/${code}`);
    await waitForChatReady(web);
    await assertChatLayout(web);
  });

  test("after sending messages", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-layout-msgs");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    const code = (await codeEl.locator("code").textContent()) ?? "";

    await web.goto(`${WEB_URL}/i/${code}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Hello layout test");
    await assertChatLayout(web);
  });

  test("message limit reached", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-layout-limit");
    await electron.getByTestId("invite-max-messages").fill("1");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    const limitCode = (await codeEl.locator("code").textContent()) ?? "";

    await web.goto(`${WEB_URL}/i/${limitCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Hit the limit");
    await expect(web.locator(".chat-input")).toBeDisabled({ timeout: 10000 });
    await assertChatLayout(web);
  });

  test("reconnect to limit-reached session", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-layout-reconnect");
    await electron.getByTestId("invite-max-messages").fill("1");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    const code = (await codeEl.locator("code").textContent()) ?? "";

    await web.goto(`${WEB_URL}/i/${code}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "One and done");
    await expect(web.locator(".chat-input")).toBeDisabled({ timeout: 10000 });

    const sessionUrl = web.url();

    // Navigate away then back — triggers history reload
    await web.goto(WEB_URL);
    await web.goto(sessionUrl);
    await expect(web.locator(".chat-bubble-assistant").first()).toBeVisible({ timeout: 15000 });
    await expect(web.locator(".chat-input")).toBeDisabled({ timeout: 10000 });
    await assertChatLayout(web);
  });

  /**
   * Key bug scenario: reconnect to session with MANY messages that overflow the viewport.
   * The user's bug: with 30 messages loaded at once, everything shifts to the top.
   * We use 15 messages (30 bubbles) with long replies to ensure content exceeds viewport height.
   */
  test("reconnect to session with many messages (overflow)", async () => {
    // Set a long mock response to ensure messages overflow the viewport
    const longResponse = "This is a detailed response that takes up more vertical space. ".repeat(3) +
      "\n\n- Point one about the topic\n- Point two with more detail\n- Point three for good measure";
    await setMockResponse(longResponse);

    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-layout-many-msgs");
    await electron.getByTestId("invite-max-messages").fill("15");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    const code = (await codeEl.locator("code").textContent()) ?? "";

    await web.goto(`${WEB_URL}/i/${code}`);
    await waitForChatReady(web);

    // Send 15 messages to fill up the session — content will far exceed viewport
    for (let i = 1; i <= 15; i++) {
      await sendAndExpectReply(web, `Layout overflow test message number ${i}`);
    }
    await expect(web.locator(".chat-input")).toBeDisabled({ timeout: 10000 });

    const sessionUrl = web.url();

    // Navigate away then back — all 30 bubbles load at once from history
    await web.goto(WEB_URL);
    await web.goto(sessionUrl);
    await expect(web.locator(".chat-bubble-assistant").first()).toBeVisible({ timeout: 15000 });
    await expect(web.locator(".chat-input")).toBeDisabled({ timeout: 10000 });

    // Wait for layout to settle after bulk history load
    await web.waitForTimeout(1000);

    await assertChatLayout(web);

    await resetMock();
  });

  test("session ended via report", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();
    await electron.getByTestId("invite-label").fill("e2e-layout-ended");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    const endCode = (await codeEl.locator("code").textContent()) ?? "";

    const skillsToggle = electron.locator(".invite-skills-dropdown-toggle");
    await skillsToggle.waitFor({ state: "visible", timeout: 15000 });
    await skillsToggle.click();
    const reportSkillLabel = electron.locator("label.invite-skills-dropdown-item").filter({ hasText: "Conversation Report" });
    await reportSkillLabel.waitFor({ state: "visible", timeout: 10000 });
    await reportSkillLabel.click();
    await skillsToggle.click();

    await setMockResponse("Mock reply for layout test");

    await web.goto(WEB_URL);
    await enterInviteCode(web, endCode);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Layout test message");

    const exportBtn = web.locator(".chat-report-btn");
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
    const downloadPromise = web.waitForEvent("download", { timeout: 60000 });
    await exportBtn.click();
    await web.locator(".confirm-ok").click();
    await downloadPromise;

    await expect(web.locator(".chat-input")).toBeDisabled({ timeout: 10000 });
    await assertChatLayout(web);

    await resetMock();
  });
});
