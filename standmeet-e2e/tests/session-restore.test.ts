import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb, waitForChatReady, sendAndExpectReply } from "../fixtures/web.js";
import { setMockResponse, resetMock, evictAllSessions, setSdkSessionId } from "../fixtures/mock.js";

/**
 * Session restore + sources persistence + content viewer.
 *
 * Covers:
 * 1. Sources display correctly in AI responses
 * 2. Sources survive in-memory reconnect (navigate away → back)
 * 3. Sources survive DB restore (evict memory → reconnect)
 * 4. Multiple messages with mixed sources restore correctly from DB
 * 5. Content viewer opens on source click
 * 6. Content viewer works after DB-restored session
 */

const WEB_URL = process.env.WEB_URL || "http://web:3000";
let electron: Page;
let web: Page;
let inviteCode: string;

test.beforeAll(async () => {
  electron = await launchElectron();
  web = await launchWeb();

  // Create test invite
  await electron.getByTestId("nav-invites").click();
  await electron.getByTestId("invite-new-btn").click();
  await electron.getByTestId("invite-label").fill("e2e-session-restore");
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

// ── 1. Sources display ─────────────────────────────────────────────

test.describe("Sources display in responses", () => {
  test("mock response with sources shows correct source buttons", async () => {
    await setMockResponse("Here is info about the owner.", {
      sources: ["profile/bio", "work/experience"],
    });

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Tell me about the owner");

    // Source buttons should appear
    const sourceItems = web.locator(".chat-source-item");
    await expect(sourceItems.first()).toBeVisible({ timeout: 10000 });
    expect(await sourceItems.count()).toBe(2);

    // Source buttons have correct titles (full path) and display names (last segment)
    await expect(web.locator(".chat-source-item[title='profile/bio']")).toBeVisible();
    await expect(web.locator(".chat-source-item[title='work/experience']")).toBeVisible();

    const sourceTexts = await sourceItems.allTextContents();
    expect(sourceTexts.some((t) => t.includes("bio"))).toBe(true);
    expect(sourceTexts.some((t) => t.includes("experience"))).toBe(true);

    await resetMock();
  });

  test("response without sources shows no source buttons", async () => {
    await setMockResponse("Hello, no sources here.");

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Just say hello");

    // No source buttons should appear for this message
    const lastBubble = web.locator(".chat-bubble-assistant").last();
    await expect(lastBubble).toBeVisible();
    const sourcesInLastBubble = lastBubble.locator(".chat-source-item");
    expect(await sourcesInLastBubble.count()).toBe(0);

    await resetMock();
  });
});

// ── 2. Sources survive in-memory reconnect ─────────────────────────

test.describe("Sources survive in-memory reconnect", () => {
  test("sources preserved after navigating away and back", async () => {
    await setMockResponse("STARFRUIT is a tropical fruit.", {
      sources: ["food/tropical"],
    });

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Tell me about starfruit");

    // Verify source is present
    await expect(web.locator(".chat-source-item[title='food/tropical']")).toBeVisible();

    // Capture session URL
    const sessionUrl = web.url();

    // Navigate away and come back
    await web.goto(WEB_URL);
    await web.goto(sessionUrl);
    await waitForChatReady(web);

    // Message content should be restored (wait for reconnection to complete)
    await expect(web.locator(".chat-container")).toContainText("STARFRUIT", { timeout: 10000 });

    // Sources should also be restored
    await expect(web.locator(".chat-source-item[title='food/tropical']")).toBeVisible({ timeout: 10000 });

    await resetMock();
  });
});

// ── 3. Sources survive DB restore ──────────────────────────────────

test.describe("Sources survive DB restore", () => {
  test("sources restored from database after memory eviction", async () => {
    await setMockResponse("DRAGONFRUIT grows in warm climates.", {
      sources: ["food/exotic", "food/tropical-fruits"],
    });

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Tell me about dragonfruit");

    // Verify sources are present
    await expect(web.locator(".chat-source-item[title='food/exotic']")).toBeVisible();
    await expect(web.locator(".chat-source-item[title='food/tropical-fruits']")).toBeVisible();

    // Capture session URL
    const sessionUrl = web.url();

    // Wait a moment for fire-and-forget persistence calls to complete
    await web.waitForTimeout(1000);

    // Evict ALL sessions from gateway memory — forces DB restore path
    await evictAllSessions();

    // Reconnect using the saved session URL
    await web.goto(sessionUrl);
    await waitForChatReady(web);

    // Wait for restored messages to appear (DB restore is async)
    await expect(web.locator(".chat-bubble-assistant").first()).toBeVisible({ timeout: 15000 });

    // Message content must be restored from DB
    const content = await web.locator(".chat-container").textContent();
    expect(content).toContain("DRAGONFRUIT");

    // Sources must be restored from DB
    await expect(web.locator(".chat-source-item[title='food/exotic']")).toBeVisible({ timeout: 10000 });
    await expect(web.locator(".chat-source-item[title='food/tropical-fruits']")).toBeVisible({ timeout: 10000 });

    await resetMock();
  });
});

// ── 4. Multiple messages with mixed sources ────────────────────────

test.describe("Mixed sources across multiple messages survive DB restore", () => {
  test("messages with and without sources all restore correctly", async () => {
    // First message: with sources
    await setMockResponse("KIWI is rich in vitamin C.", {
      sources: ["nutrition/fruits"],
    });

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Tell me about kiwi");
    await expect(web.locator(".chat-source-item[title='nutrition/fruits']")).toBeVisible();

    // Second message: no sources
    await setMockResponse("That is a great question!");
    await sendAndExpectReply(web, "What do you think?");

    // Third message: different sources
    await setMockResponse("MANGO is widely popular.", {
      sources: ["food/mango", "recipes/smoothie"],
    });
    await sendAndExpectReply(web, "Tell me about mango");
    await expect(web.locator(".chat-source-item[title='food/mango']")).toBeVisible();
    await expect(web.locator(".chat-source-item[title='recipes/smoothie']")).toBeVisible();

    // Capture session URL
    const sessionUrl = web.url();

    // Wait for persistence
    await web.waitForTimeout(1000);

    // Evict and reconnect via DB
    await evictAllSessions();
    await web.goto(sessionUrl);
    await waitForChatReady(web);

    // Wait for restored messages to appear (DB restore is async)
    await expect(web.locator(".chat-bubble-assistant").first()).toBeVisible({ timeout: 15000 });

    // All messages should be restored
    const fullText = await web.locator(".chat-container").textContent();
    expect(fullText).toContain("KIWI");
    expect(fullText).toContain("great question");
    expect(fullText).toContain("MANGO");

    // First message sources restored
    await expect(web.locator(".chat-source-item[title='nutrition/fruits']")).toBeVisible({ timeout: 10000 });

    // Third message sources restored
    await expect(web.locator(".chat-source-item[title='food/mango']")).toBeVisible();
    await expect(web.locator(".chat-source-item[title='recipes/smoothie']")).toBeVisible();

    // Second message should have NO source buttons — count total source buttons
    const allSources = web.locator(".chat-source-item");
    // Expected: nutrition/fruits (1) + food/mango + recipes/smoothie (2) = 3
    // Plus any sources from prior tests in this session... let's check by assistant bubble
    const secondBubble = web.locator(".chat-bubble-assistant").nth(1);
    expect(await secondBubble.locator(".chat-source-item").count()).toBe(0);

    await resetMock();
  });
});

// ── 5. Expired SDK session retry ──────────────────────────────────

test.describe("Expired SDK session retries with history context", () => {
  test("message succeeds after simulated SDK session expiration", async () => {
    // Send a first message to establish history
    await setMockResponse("COCONUT is a versatile fruit.");
    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Tell me about coconut");
    const content = await web.locator(".chat-container").textContent();
    expect(content).toContain("COCONUT");

    // Inject a fake stale sdkSessionId + enable simulateExpiredSession
    await setSdkSessionId("fake-expired-session-id");
    await setMockResponse("LYCHEE is sweet and fragrant.", {
      simulateExpiredSession: true,
    });

    // Send another message — should trigger retry (not error)
    await sendAndExpectReply(web, "Tell me about lychee");

    // Verify the response came through (retry succeeded)
    const fullText = await web.locator(".chat-container").textContent();
    expect(fullText).toContain("LYCHEE");

    // Verify no error message was shown
    await expect(web.locator(".chat-error")).not.toBeVisible();

    await resetMock();
  });
});

// ── 6 & 7. Content viewer ──────────────────────────────────────────

test.describe("Content viewer", () => {
  const contentPath = "test/e2e-viewer";
  const contentBody = "This is content for the viewer test. PAPAYA data.";

  test("create content for viewer test", async () => {
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("content-new-btn").click();
    await electron.getByTestId("content-new-input").fill(contentPath);
    await electron.getByTestId("content-new-input").press("Enter");
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });
    await electron.getByTestId("editor-summary").fill("Viewer test content");
    await electron.getByTestId("editor-content").fill(contentBody);
    await electron.getByTestId("editor-save").click();
    await expect(electron.locator(".alert.error")).not.toBeVisible({ timeout: 5000 });
  });

  test("clicking source opens content viewer panel", async () => {
    await setMockResponse("Here is info about PAPAYA.", {
      sources: [contentPath],
    });

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Tell me about papaya");

    // Click the specific source button
    const sourceBtn = web.locator(`.chat-source-item[title='${contentPath}']`);
    await expect(sourceBtn).toBeVisible();
    await sourceBtn.click();

    // Content viewer panel should appear
    const panel = web.locator(".content-viewer-panel");
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Panel should show the content
    const panelText = await panel.textContent();
    expect(panelText).toContain("PAPAYA");

    // Close button should work
    await web.locator(".content-viewer-close").click();
    await expect(panel).not.toBeVisible();

    await resetMock();
  });

  test("content viewer works after DB-restored session", async () => {
    await setMockResponse("GUAVA is fragrant.", {
      sources: [contentPath],
    });

    await web.goto(`${WEB_URL}/i/${inviteCode}`);
    await waitForChatReady(web);
    await sendAndExpectReply(web, "Tell me about guava");
    await expect(web.locator(`.chat-source-item[title='${contentPath}']`).last()).toBeVisible();

    const sessionUrl = web.url();
    await web.waitForTimeout(1000);

    // Evict and reconnect via DB
    await evictAllSessions();
    await web.goto(sessionUrl);
    await waitForChatReady(web);

    // Wait for restored messages
    await expect(web.locator(".chat-bubble-assistant").first()).toBeVisible({ timeout: 15000 });

    // Source should be restored — use last() since prior test's sources may also be present
    const sourceBtn = web.locator(`.chat-source-item[title='${contentPath}']`).last();
    await expect(sourceBtn).toBeVisible({ timeout: 10000 });

    // Click the restored source — content viewer should still work
    await sourceBtn.click();
    const panel = web.locator(".content-viewer-panel");
    await expect(panel).toBeVisible({ timeout: 10000 });

    const panelText = await panel.textContent();
    expect(panelText).toContain("PAPAYA");

    await web.locator(".content-viewer-close").click();
    await expect(panel).not.toBeVisible();

    await resetMock();
  });

  test("cleanup: delete test content", async () => {
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("file-tree-item-test-e2e-viewer").click();
    await electron.getByTestId("editor-content").waitFor({ state: "visible" });
    electron.on("dialog", (dialog) => dialog.accept());
    await electron.getByTestId("editor-delete").click();
  });
});
