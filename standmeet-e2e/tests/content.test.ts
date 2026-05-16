import { test, expect, type Page } from "@playwright/test";
import { launchElectron, getElectronPage, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";

/**
 * Content management full lifecycle.
 * Owner creates/edits/deletes content in Electron → Visitor verifies via Web chat.
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

test.describe("Content management", () => {
  const contentPath = "test/bio";
  const contentBody = "I am a software engineer who loves building AI products.";
  const contentSummary = "Personal bio for e2e test";
  let inviteCode: string;

  test("create content entry via Electron", async () => {
    // Navigate to Content page
    await electron.getByTestId("nav-content").click();

    // Create new content
    await electron.getByTestId("content-new-btn").click();
    await electron.getByTestId("content-new-input").fill(contentPath);
    await electron.getByTestId("content-new-input").press("Enter");

    // Wait for editor to appear
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });

    // Fill in content details
    await electron.getByTestId("editor-summary").fill(contentSummary);
    await electron.getByTestId("editor-content").fill(contentBody);

    // Save
    await electron.getByTestId("editor-save").click();

    // Verify save succeeded (no error alert visible)
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });
  });

  test("set content visibility to public", async () => {
    // Toggle public checkbox
    const publicCheckbox = electron.getByTestId("editor-public");
    if (!(await publicCheckbox.isChecked())) {
      await publicCheckbox.check();
    }
    await electron.getByTestId("editor-save").click();
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });
  });

  test("create private content entry", async () => {
    // Ensure we're on the content page
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("content-new-btn").waitFor({ state: "visible" });
    await electron.getByTestId("content-new-btn").click();
    await electron.getByTestId("content-new-input").waitFor({ state: "visible", timeout: 10000 });
    await electron.getByTestId("content-new-input").fill("test/secret");
    await electron.getByTestId("content-new-input").press("Enter");

    await electron.getByTestId("editor-content").waitFor({ state: "visible" });
    await electron.getByTestId("editor-summary").fill("Secret info");
    await electron.getByTestId("editor-content").fill("This is top secret information.");

    // Ensure private (uncheck public if checked)
    const publicCheckbox = electron.getByTestId("editor-public");
    if (await publicCheckbox.isChecked()) {
      await publicCheckbox.uncheck();
    }

    await electron.getByTestId("editor-save").click();
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });
  });

  test("create invite for content testing", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();

    await electron.getByTestId("invite-label").fill("e2e-content-test");
    await electron.getByTestId("invite-create-btn").click();

    // Wait for invite to be created and get the code
    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    inviteCode = (await codeEl.locator("code").textContent()) ?? "";
    expect(inviteCode).toMatch(/^sm_/);
  });

  test("visitor can chat about owner content via web", async () => {
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteCode);
    await waitForChatReady(web);

    const reply = await sendAndExpectReply(web, "Tell me about the owner");
    expect(reply.length).toBeGreaterThan(0);
  });

  test("modify content in Electron", async () => {
    await electron.getByTestId("nav-content").click();

    // Click on the content item in the file tree
    await electron.getByTestId("file-tree-item-test-bio").click();
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });

    // Update content
    await electron.getByTestId("editor-content").fill(
      "I am a senior software engineer specializing in AI and distributed systems.",
    );
    await electron.getByTestId("editor-save").click();
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });
  });

  test("delete content entries", async () => {
    // Delete test/bio
    await electron.getByTestId("file-tree-item-test-bio").click();
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });

    // Handle confirm dialog
    electron.on("dialog", (dialog) => dialog.accept());
    await electron.getByTestId("editor-delete").click();

    // Delete test/secret
    await electron.getByTestId("file-tree-item-test-secret").click();
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });
    await electron.getByTestId("editor-delete").click();
  });
});
