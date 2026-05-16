import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";

/**
 * Settings page E2E tests.
 * Tests IM integrations CRUD via the Electron Settings page + Django API.
 */

let electron: Page;

test.beforeAll(async () => {
  electron = await launchElectron();
});

test.afterAll(async () => {
  await closeElectron();
});

test.describe("IM Integrations settings", () => {
  test("settings page shows IM Integrations section with all platforms", async () => {
    await electron.getByTestId("nav-settings").click();

    // All three platform cards should be visible
    await expect(electron.getByTestId("im-card-telegram")).toBeVisible();
    await expect(electron.getByTestId("im-card-discord")).toBeVisible();
    await expect(electron.getByTestId("im-card-slack")).toBeVisible();

    // All toggles should be unchecked initially
    await expect(electron.getByTestId("im-toggle-telegram")).not.toBeChecked();
    await expect(electron.getByTestId("im-toggle-discord")).not.toBeChecked();
    await expect(electron.getByTestId("im-toggle-slack")).not.toBeChecked();
  });

  test("enabling Telegram shows bot_token field and guide", async () => {
    await electron.getByTestId("im-toggle-telegram").check();

    // Token field should appear
    const tokenInput = electron.getByTestId("im-telegram-bot_token");
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveAttribute("type", "password");

    // Guide text should appear
    const guide = electron.getByTestId("im-guide-telegram");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("BotFather");
  });

  test("enabling Discord shows bot_token, application_id fields and guide", async () => {
    await electron.getByTestId("im-toggle-discord").check();

    await expect(electron.getByTestId("im-discord-bot_token")).toBeVisible();
    await expect(electron.getByTestId("im-discord-application_id")).toBeVisible();

    const guide = electron.getByTestId("im-guide-discord");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("discord.com/developers");
  });

  test("enabling Slack shows bot_token, app_token fields and guide", async () => {
    await electron.getByTestId("im-toggle-slack").check();

    await expect(electron.getByTestId("im-slack-bot_token")).toBeVisible();
    await expect(electron.getByTestId("im-slack-app_token")).toBeVisible();

    const guide = electron.getByTestId("im-guide-slack");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("api.slack.com");
  });

  test("save IM settings and verify persisted after reload", async () => {
    // Fill in Telegram token
    await electron.getByTestId("im-telegram-bot_token").fill("123456:TEST-TOKEN");

    // Save
    await electron.getByTestId("settings-save-btn").click();

    // Verify success feedback
    await expect(electron.locator(".alert.success")).toBeVisible({ timeout: 10000 });
    await expect(electron.locator(".alert.error")).not.toBeVisible();

    // Navigate away and back to verify persistence
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("nav-settings").click();

    // Telegram should still be enabled
    await expect(electron.getByTestId("im-toggle-telegram")).toBeChecked();
    // Token should be preserved
    const tokenValue = await electron.getByTestId("im-telegram-bot_token").inputValue();
    expect(tokenValue).toBe("123456:TEST-TOKEN");
  });

  test("disabling platform hides token fields", async () => {
    // Uncheck Telegram
    await electron.getByTestId("im-toggle-telegram").uncheck();

    // Token field should disappear
    await expect(electron.getByTestId("im-telegram-bot_token")).not.toBeVisible();
  });

  test("cleanup: disable all IM integrations", async () => {
    // Make sure we're on settings page
    await electron.getByTestId("nav-settings").click();

    // Uncheck all
    const telegToggle = electron.getByTestId("im-toggle-telegram");
    if (await telegToggle.isChecked()) await telegToggle.uncheck();
    const discordToggle = electron.getByTestId("im-toggle-discord");
    if (await discordToggle.isChecked()) await discordToggle.uncheck();
    const slackToggle = electron.getByTestId("im-toggle-slack");
    if (await slackToggle.isChecked()) await slackToggle.uncheck();

    await electron.getByTestId("settings-save-btn").click();
    await expect(electron.locator(".alert.success")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Django settings API: im_integrations", () => {
  const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
  const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

  test("GET /api/settings/ returns im_integrations field", async () => {
    const res = await fetch(`${DJANGO_URL}/api/settings/`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("im_integrations");
    expect(typeof data.im_integrations).toBe("object");
  });

  test("PATCH /api/settings/ can set im_integrations", async () => {
    const payload = {
      im_integrations: {
        telegram: { enabled: true, bot_token: "api-test-token" },
      },
    };

    const res = await fetch(`${DJANGO_URL}/api/settings/`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.im_integrations.telegram.enabled).toBe(true);
    expect(data.im_integrations.telegram.bot_token).toBe("api-test-token");
  });

  test("im_integrations persists across GET after PATCH", async () => {
    const res = await fetch(`${DJANGO_URL}/api/settings/`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    const data = await res.json();
    expect(data.im_integrations.telegram.enabled).toBe(true);
    expect(data.im_integrations.telegram.bot_token).toBe("api-test-token");
  });

  test("PATCH can update individual platform without losing others", async () => {
    // Add Discord config
    const res = await fetch(`${DJANGO_URL}/api/settings/`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        im_integrations: {
          telegram: { enabled: true, bot_token: "api-test-token" },
          discord: { enabled: true, bot_token: "discord-test-token", application_id: "12345" },
        },
      }),
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    // Both should be present
    expect(data.im_integrations.telegram.enabled).toBe(true);
    expect(data.im_integrations.discord.enabled).toBe(true);
    expect(data.im_integrations.discord.application_id).toBe("12345");
  });

  test("cleanup: reset im_integrations", async () => {
    const res = await fetch(`${DJANGO_URL}/api/settings/`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ im_integrations: {} }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Object.keys(data.im_integrations)).toHaveLength(0);
  });
});
