import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";

/**
 * Skill import from URL — Marketplace tab.
 * Tests the flow: paste URL → install → skill appears in My Skills → cleanup.
 * Uses the gateway's /test/fixture/skill-md endpoint as the SKILL.md source.
 */

const GATEWAY_HTTP_URL = (process.env.GATEWAY_URL || "ws://gateway:8001").replace(/^ws/, "http");
const SKILL_MD_URL = `${GATEWAY_HTTP_URL}/test/fixture/skill-md`;

let electron: Page;

test.beforeAll(async () => {
  electron = await launchElectron();
});

test.afterAll(async () => {
  await closeElectron();
});

test.describe("Skill import from URL", () => {
  test("install skill from URL via Marketplace tab", async () => {
    // Navigate to Skills page
    await electron.getByTestId("nav-skills").click();

    // Switch to Marketplace tab
    await electron.getByTestId("skills-tab-marketplace").click();

    // Enter the fixture URL
    await electron.getByTestId("marketplace-url").fill(SKILL_MD_URL);

    // Click Install
    await electron.getByTestId("marketplace-install-btn").click();

    // Wait for success message
    const success = electron.getByTestId("marketplace-success");
    await expect(success).toBeVisible({ timeout: 15000 });
    await expect(success).toContainText("E2E URL Import Test Skill");
  });

  test("imported skill appears in My Skills tab", async () => {
    // Switch to My Skills tab
    await electron.getByTestId("skills-tab-my").click();

    // Verify the imported skill is in the list
    const skillItem = electron.locator("button.iam-role-item").filter({ hasText: "E2E URL Import Test Skill" });
    await expect(skillItem).toBeVisible({ timeout: 10000 });

    // Click to see details
    await skillItem.click();

    // Verify description is shown
    await expect(electron.getByTestId("skill-description")).toHaveValue("A skill imported via URL for testing");
  });

  test("importing invalid URL shows error", async () => {
    // Switch to Marketplace tab
    await electron.getByTestId("skills-tab-marketplace").click();

    // Enter a bad URL
    await electron.getByTestId("marketplace-url").fill("http://gateway:8001/nonexistent");
    await electron.getByTestId("marketplace-install-btn").click();

    // Should show an error
    const errorEl = electron.getByTestId("marketplace-error");
    await expect(errorEl).toBeVisible({ timeout: 15000 });
  });

  test("cleanup: delete imported skill", async () => {
    // Switch to My Skills and delete the test skill
    await electron.getByTestId("skills-tab-my").click();
    const skillItem = electron.locator("button.iam-role-item").filter({ hasText: "E2E URL Import Test Skill" });
    await skillItem.click();

    electron.on("dialog", (dialog) => dialog.accept());
    await electron.getByTestId("skill-delete-btn").click();

    // Verify it's gone
    await expect(skillItem).not.toBeVisible({ timeout: 10000 });
  });
});
