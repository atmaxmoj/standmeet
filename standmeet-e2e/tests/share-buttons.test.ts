import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";

/**
 * Share buttons E2E tests.
 * Tests the horizontal share button row in InviteDetail:
 * rendering, enabled/disabled states, copy behavior, tooltip content.
 */

const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

let electron: Page;
let testInviteCode: string;

async function patchSettings(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${DJANGO_URL}/api/settings/`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${OWNER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`PATCH settings failed: ${res.status}`);
}

test.beforeAll(async () => {
  // Reset IM integrations to clean state
  await patchSettings({ im_integrations: {} });

  electron = await launchElectron();

  // Create a test invite
  await electron.getByTestId("nav-invites").click();
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-share-btns");
  await electron.getByTestId("invite-create-btn").click();

  const codeEl = electron.getByTestId("invite-code");
  await codeEl.waitFor({ state: "visible", timeout: 10000 });
  testInviteCode = (await codeEl.locator("code").textContent()) ?? "";
});

test.afterAll(async () => {
  // Cleanup: reset IM integrations
  await patchSettings({ im_integrations: {} }).catch(() => {});
  await closeElectron();
});

test.describe("Share buttons rendering", () => {
  test("all 4 share buttons are visible", async () => {
    await expect(electron.getByTestId("share-btn-web")).toBeVisible();
    await expect(electron.getByTestId("share-btn-telegram")).toBeVisible();
    await expect(electron.getByTestId("share-btn-discord")).toBeVisible();
    await expect(electron.getByTestId("share-btn-slack")).toBeVisible();
  });

  test("Web button is enabled (webUrl is always configured in test)", async () => {
    await expect(electron.getByTestId("share-btn-web")).toBeEnabled();
  });

  test("Telegram, Discord, Slack buttons are disabled by default", async () => {
    await expect(electron.getByTestId("share-btn-telegram")).toBeDisabled();
    await expect(electron.getByTestId("share-btn-discord")).toBeDisabled();
    await expect(electron.getByTestId("share-btn-slack")).toBeDisabled();
  });
});

test.describe("Web share", () => {
  test("clicking Web button copies URL containing /i/{code}", async () => {
    await electron.getByTestId("share-btn-web").click();
    const clipboard = await electron.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(`/i/${testInviteCode}`);
  });

  test("Web button title contains visitor guidance", async () => {
    const title = await electron.getByTestId("share-btn-web").getAttribute("title");
    expect(title).toContain(`/i/${testInviteCode}`);
    expect(title).toContain("Visitor opens this URL to start chatting");
  });
});

test.describe("Telegram unconfigured", () => {
  test("Telegram button disabled and title mentions Settings", async () => {
    await expect(electron.getByTestId("share-btn-telegram")).toBeDisabled();
    const title = await electron.getByTestId("share-btn-telegram").getAttribute("title");
    expect(title).toContain("Settings");
  });
});

test.describe("Telegram configured", () => {
  test.beforeAll(async () => {
    await patchSettings({
      im_integrations: {
        telegram: { enabled: true, bot_token: "123:TEST", bot_username: "testbot" },
      },
    });

    // Reload invites page to pick up new settings
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId(`invite-item-${testInviteCode}`).click();
    await electron.getByTestId("share-btn-telegram").waitFor({ state: "visible" });
  });

  test("Telegram button is enabled", async () => {
    await expect(electron.getByTestId("share-btn-telegram")).toBeEnabled();
  });

  test("clicking Telegram button copies deep link", async () => {
    await electron.getByTestId("share-btn-telegram").click();
    const clipboard = await electron.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(`t.me/testbot?start=${testInviteCode}`);
  });

  test("Telegram button title contains deep link and guidance", async () => {
    const title = await electron.getByTestId("share-btn-telegram").getAttribute("title");
    expect(title).toContain(`t.me/testbot?start=${testInviteCode}`);
    expect(title).toContain("Opens a private chat");
  });
});

test.describe("Discord configured", () => {
  test.beforeAll(async () => {
    await patchSettings({
      im_integrations: {
        telegram: { enabled: true, bot_token: "123:TEST", bot_username: "testbot" },
        discord: { enabled: true, bot_token: "discord-token", application_id: "12345" },
      },
    });

    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId(`invite-item-${testInviteCode}`).click();
    await electron.getByTestId("share-btn-discord").waitFor({ state: "visible" });
  });

  test("Discord button is enabled", async () => {
    await expect(electron.getByTestId("share-btn-discord")).toBeEnabled();
  });

  test("clicking Discord button copies bot install link and instructions", async () => {
    await electron.getByTestId("share-btn-discord").click();
    const clipboard = await electron.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("discord.com/oauth2/authorize");
    expect(clipboard).toContain(testInviteCode);
  });

  test("Discord button title contains copy instructions guidance", async () => {
    const title = await electron.getByTestId("share-btn-discord").getAttribute("title");
    expect(title).toContain("Copy bot install link");
  });
});

test.describe("Slack configured", () => {
  test.beforeAll(async () => {
    await patchSettings({
      im_integrations: {
        telegram: { enabled: true, bot_token: "123:TEST", bot_username: "testbot" },
        discord: { enabled: true, bot_token: "discord-token", application_id: "12345" },
        slack: { enabled: true, bot_token: "slack-bot-token", app_token: "slack-app-token" },
      },
    });

    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("nav-invites").click();
    await electron.getByTestId(`invite-item-${testInviteCode}`).click();
    await electron.getByTestId("share-btn-slack").waitFor({ state: "visible" });
  });

  test("Slack button is enabled", async () => {
    await expect(electron.getByTestId("share-btn-slack")).toBeEnabled();
  });

  test("clicking Slack button copies invite code with instructions", async () => {
    await electron.getByTestId("share-btn-slack").click();
    const clipboard = await electron.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(testInviteCode);
    expect(clipboard).toContain("Paste this in a channel or DM");
  });

  test("Slack button title contains copy instructions guidance", async () => {
    const title = await electron.getByTestId("share-btn-slack").getAttribute("title");
    expect(title).toContain("Copy invite code with instructions");
  });
});
