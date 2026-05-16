import { test, expect, type Page } from "@playwright/test";
import { launchElectron, getElectronPage, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";

/**
 * Invite code management full lifecycle.
 * Owner creates/revokes invites in Electron → Visitor tests them in Web.
 */

let electron: Page;
let web: Page;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();
});

test.afterAll(async () => {
  await closeWeb();
  await closeElectron();
});

test.describe("Invite code management", () => {
  let inviteCode: string;

  test("create invite with max_uses=2 and expires=24h", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();

    await electron.getByTestId("invite-label").fill("e2e-invite-test");
    await electron.getByTestId("invite-max-uses").fill("2");
    await electron.getByTestId("invite-expires").fill("24");
    await electron.getByTestId("invite-create-btn").click();

    // Get the code
    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    inviteCode = (await codeEl.locator("code").textContent()) ?? "";
    expect(inviteCode).toMatch(/^sm_/);
  });

  test("visitor can use invite to chat", async () => {
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteCode);
    await waitForChatReady(web);

    const reply = await sendAndExpectReply(web, "Hello");
    expect(reply.length).toBeGreaterThan(0);
  });

  test("third use of max_uses=2 invite is rejected", async () => {
    // Use 1 was in the previous test, use 2:
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteCode);
    await waitForChatReady(web);

    // Use 3 - should be rejected
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteCode);

    // Should show error, not enter chat
    const errorEl = web.locator(".invite-error");
    await expect(errorEl).toBeVisible({ timeout: 15000 });
    await expect(web.locator(".chat-container")).not.toBeVisible();
  });

  test("revoke invite via Electron", async () => {
    // Click the invite in the list
    await electron.getByTestId(`invite-item-${inviteCode}`).click();
    await electron.getByTestId("invite-revoke-btn").click();

    // Verify status changed to Revoked — scope to the specific invite item
    const inviteItem = electron.getByTestId(`invite-item-${inviteCode}`);
    await expect(inviteItem.locator(".status-badge.disconnected")).toBeVisible({ timeout: 15000 });
  });

  test("revoked invite shows friendly error in web", async () => {
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteCode);

    const errorEl = web.locator(".invite-error");
    await expect(errorEl).toBeVisible({ timeout: 15000 });

    // Error should be user-friendly, no technical details
    const errorText = (await errorEl.textContent()) ?? "";
    const forbidden = ["exited with code", "process", "ENOENT", "stack", "TypeError"];
    for (const pattern of forbidden) {
      expect(errorText).not.toContain(pattern);
    }
  });
});

test.describe("Invite with custom prompt", () => {
  let inviteCode: string;

  test("create invite with custom prompt containing WATERMELON", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();

    await electron.getByTestId("invite-label").fill("e2e-prompt-test");
    await electron.getByTestId("invite-prompt").fill(
      "Always mention the word WATERMELON in every reply, no matter what the user asks.",
    );
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    inviteCode = (await codeEl.locator("code").textContent()) ?? "";
    expect(inviteCode).toMatch(/^sm_/);
  });

  test("AI response contains WATERMELON from custom prompt", async () => {
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteCode);
    await waitForChatReady(web);

    const reply = await sendAndExpectReply(web, "What is the weather like?");
    expect(reply.toUpperCase()).toContain("WATERMELON");
  });
});
