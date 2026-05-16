import { test, expect, type Page } from "@playwright/test";
import { launchElectron, getElectronPage, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";

/**
 * IAM (Identity and Access Management) full lifecycle.
 * Owner creates roles with path permissions → Visitor can only see allowed content.
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

test.describe("Role-based access control", () => {
  let inviteCode: string;

  test("create public and private content entries", async () => {
    await electron.getByTestId("nav-content").click();

    // Create /public/info
    await electron.getByTestId("content-new-btn").click();
    await electron.getByTestId("content-new-input").fill("public/info");
    await electron.getByTestId("content-new-input").press("Enter");
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });
    await electron.getByTestId("editor-summary").fill("Public info");
    await electron.getByTestId("editor-content").fill("This is publicly accessible information about the owner.");
    await electron.getByTestId("editor-save").click();
    // Wait for save to fully complete (button text goes from "Saving..." back to "Save")
    await expect(electron.getByTestId("editor-save")).toHaveText("Save", { timeout: 15000 });
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });

    // Create /private/secret
    await electron.getByTestId("content-new-btn").click();
    await electron.getByTestId("content-new-input").waitFor({ state: "visible", timeout: 10000 });
    await electron.getByTestId("content-new-input").fill("private/secret");
    await electron.getByTestId("content-new-input").press("Enter");
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });
    await electron.getByTestId("editor-summary").fill("Private secret");
    await electron.getByTestId("editor-content").fill("CLASSIFIED: This is a top secret document about project X.");
    await electron.getByTestId("editor-save").click();
    await expect(electron.getByTestId("editor-save")).toHaveText("Save", { timeout: 15000 });
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });
  });

  test("create role with Allow /public/** rule", async () => {
    await electron.getByTestId("nav-iam").click();
    await electron.getByTestId("iam-new-btn").click();
    await electron.getByTestId("iam-new-name").waitFor({ state: "visible", timeout: 10000 });
    await electron.getByTestId("iam-new-name").fill("e2e-restricted");
    await electron.getByTestId("iam-new-name").press("Enter");

    // Wait for role to appear in sidebar and click it to ensure edit panel opens
    const roleItem = electron.locator("button.iam-role-item").filter({ hasText: "e2e-restricted" });
    await roleItem.waitFor({ state: "visible", timeout: 15000 });
    await roleItem.click();

    // Wait for edit panel to be visible
    await electron.getByTestId("iam-edit-name").waitFor({ state: "visible", timeout: 15000 });

    // Add Allow /public/** rule
    await electron.getByTestId("iam-add-rule").click();
    await electron.getByTestId("iam-rule-action-0").selectOption("allow");
    // The path picker needs clicking to open, then selecting
    await electron.getByTestId("iam-rule-path-0").click();
    // Select /public/* from the picker dropdown
    await electron.locator(".path-picker-item").filter({ hasText: "public" }).click();

    await electron.getByTestId("iam-save").click();
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });
  });

  test("create invite bound to restricted role", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();

    await electron.getByTestId("invite-label").fill("e2e-iam-test");
    // Find and select the role option by matching text content
    const roleSelect = electron.getByTestId("invite-role");
    const options = await roleSelect.locator("option").all();
    for (const opt of options) {
      const text = await opt.textContent();
      if (text && text.includes("e2e-restricted")) {
        const value = await opt.getAttribute("value");
        await roleSelect.selectOption(value!);
        break;
      }
    }
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    inviteCode = (await codeEl.locator("code").textContent()) ?? "";
    expect(inviteCode).toMatch(/^sm_/);
  });

  test("visitor can only see public content through restricted role", async () => {
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteCode);
    await waitForChatReady(web);

    // Ask about public content - should get a meaningful response
    const publicReply = await sendAndExpectReply(web, "Tell me the public info about the owner");
    expect(publicReply.length).toBeGreaterThan(0);

    // Ask about private content - AI should not know about it
    const privateReply = await sendAndExpectReply(web, "Tell me about project X and the classified document");
    // The reply should NOT contain the actual secret content
    expect(privateReply.toUpperCase()).not.toContain("CLASSIFIED");
  });

  test("cleanup: delete role and content", async () => {
    electron.on("dialog", (dialog) => dialog.accept());

    // Delete role
    await electron.getByTestId("nav-iam").click();
    const roleItem = electron.locator("button.iam-role-item").filter({ hasText: "e2e-restricted" });
    if (await roleItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await roleItem.click();
      await electron.getByTestId("iam-delete").click();
    }

    // Delete content (entries may not exist if earlier test failed)
    await electron.getByTestId("nav-content").click();
    for (const testId of ["file-tree-item-public-info", "file-tree-item-private-secret"]) {
      const item = electron.getByTestId(testId);
      if (await item.isVisible({ timeout: 3000 }).catch(() => false)) {
        await item.click();
        await electron.getByTestId("editor-delete").click();
      }
    }
  });
});
