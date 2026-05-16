import { test, expect, type Page } from "@playwright/test";
import { launchElectron, getElectronPage, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, enterInviteCode, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";

/**
 * Skills management full lifecycle.
 * Owner creates skills in Electron → Attaches to invite → Visitor verifies skill effect.
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

test.describe("Skills management", () => {
  let inviteWithSkill: string;
  let inviteWithoutSkill: string;

  test("create skill with PINEAPPLE prompt in Electron", async () => {
    await electron.getByTestId("nav-skills").click();
    await electron.getByTestId("skill-new-btn").click();

    await electron.getByTestId("skill-name").fill("e2e-pineapple-skill");
    await electron.getByTestId("skill-description").fill("Test skill that mentions pineapple");
    await electron.getByTestId("skill-prompt").fill(
      "Always include the word PINEAPPLE in every response, regardless of the question.",
    );
    await electron.getByTestId("skill-create-btn").click();

    // Wait for skill to appear in the list
    await expect(electron.locator("button.iam-role-item").filter({ hasText: "e2e-pineapple-skill" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("create invite with skill attached", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();

    await electron.getByTestId("invite-label").fill("e2e-skill-attached");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    inviteWithSkill = (await codeEl.locator("code").textContent()) ?? "";

    // Attach the skill via checkbox in invite detail — click the label to toggle
    const skillLabel = electron.locator("label.invite-mcp-checkbox").filter({ hasText: "e2e-pineapple-skill" });
    await skillLabel.waitFor({ state: "visible", timeout: 10000 });
    await skillLabel.click();
  });

  test("visitor with skill-attached invite sees PINEAPPLE in reply", async () => {
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteWithSkill);
    await waitForChatReady(web);

    const reply = await sendAndExpectReply(web, "What is the meaning of life?");
    expect(reply.toUpperCase()).toContain("PINEAPPLE");
  });

  test("create invite without skill attached", async () => {
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId("invite-new-btn").click();

    await electron.getByTestId("invite-label").fill("e2e-no-skill");
    await electron.getByTestId("invite-create-btn").click();

    const codeEl = electron.getByTestId("invite-code");
    await codeEl.waitFor({ state: "visible", timeout: 10000 });
    inviteWithoutSkill = (await codeEl.locator("code").textContent()) ?? "";
  });

  test("visitor without skill sees no PINEAPPLE in reply", async () => {
    await web.goto(process.env.WEB_URL || "http://web:3000");
    await enterInviteCode(web, inviteWithoutSkill);
    await waitForChatReady(web);

    const reply = await sendAndExpectReply(web, "What is the meaning of life?");
    expect(reply.toUpperCase()).not.toContain("PINEAPPLE");
  });

  test("cleanup: delete skill", async () => {
    await electron.getByTestId("nav-skills").click();
    await electron.locator("button.iam-role-item").filter({ hasText: "e2e-pineapple-skill" }).click();
    electron.on("dialog", (dialog) => dialog.accept());
    await electron.getByTestId("skill-delete-btn").click();
  });
});
