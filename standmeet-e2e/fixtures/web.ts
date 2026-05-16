import { type Page, type BrowserContext, chromium } from "@playwright/test";

const WEB_URL = process.env.WEB_URL || "http://web:3000";

let browser: Awaited<ReturnType<typeof chromium.launch>>;
let context: BrowserContext;
let webPage: Page;

/**
 * Launch a Chromium browser for visitor (web) interactions.
 */
export async function launchWeb(): Promise<Page> {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  webPage = await context.newPage();
  await webPage.goto(WEB_URL);
  return webPage;
}

export function getWebPage(): Page {
  return webPage;
}

export async function createWebPage(): Promise<Page> {
  return await context.newPage();
}

/**
 * Create a page in a NEW browser context (isolated cookies/storage).
 * Useful for simulating a different visitor with the same invite code.
 */
export async function createIsolatedWebPage(): Promise<Page> {
  const newContext = await browser.newContext();
  return await newContext.newPage();
}

export async function closeWeb(): Promise<void> {
  if (browser) {
    await browser.close();
  }
}

/**
 * Enter an invite code on the web landing page.
 */
export async function enterInviteCode(page: Page, code: string): Promise<void> {
  // Click the "Have an invite code?" button to reveal the input
  const inviteBtn = page.getByRole("button", { name: /invite/i });
  if (await inviteBtn.isVisible()) {
    await inviteBtn.click();
  }

  // Fill in the code (input has id="invite-code", placeholder="sm_xxxxx")
  const input = page.locator("#invite-code");
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(code);

  // Click Continue
  const continueBtn = page.getByRole("button", { name: /continue/i });
  await continueBtn.click();
}

/**
 * Wait until the chat interface is ready (connected and showing input).
 */
export async function waitForChatReady(page: Page): Promise<void> {
  await page.locator(".chat-input").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

/**
 * Send a message and wait for an assistant reply.
 */
export async function sendAndExpectReply(
  page: Page,
  message: string,
  timeout = 60_000,
): Promise<string> {
  // Type message
  const input = page.locator(".chat-input");
  await input.fill(message);

  // Count existing assistant messages before sending
  const beforeCount = await page.locator(".chat-bubble-assistant").count();

  // Send
  const sendBtn = page.locator(".chat-send-btn, button[type='submit']").first();
  await sendBtn.click();

  // Wait for a new assistant message
  await page
    .locator(".chat-bubble-assistant")
    .nth(beforeCount)
    .waitFor({ state: "visible", timeout });

  // Return the text of the new message
  const newMessage = page.locator(".chat-bubble-assistant").nth(beforeCount);
  return (await newMessage.textContent()) ?? "";
}
