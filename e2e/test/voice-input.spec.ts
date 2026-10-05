// voice-input.spec.ts —— a visitor speaks a question instead of typing it
// (docs/design/voice-input.md; owner 2026-09-30 "服务器端转写吧", 2026-10-01 "语音输入，你就做吧").
//
// Real stack, real model: the backend runs SenseVoice in process (internal/infra/stt). Chromium's
// fake microphone plays a recorded English sentence followed by silence; the visitor presses the
// mic once, and the pause ends the recording and sends the question (owner 2026-10-02: "自动识别
// 断句自行发送"). The mic is a visible control level with ASK (owner 2026-10-02: the ring was too
// faint and sat lower). A Chinese recording goes through the same route. The caps and the session
// check refuse with a sentence.
//
// RED on the code of 2026-10-01: there is no mic, no /transcribe and no /voice. RED on v0.1.109:
// the words wait in the box for Enter, and the mic is an unlabelled ring below ASK's centre line.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { enterCodeSession } from '@/fixtures/navigate';
import { audioFile, fakeMicArgs, transcribeFile } from '@/fixtures/voice';

const OWNER = {
  email: 'voice-input@example.com', password: 'correct-horse-battery-staple',
  handle: 'voiceowner', fullName: 'Voice Owner',
};
const CODE = 'VOICE-01';
const BASE = process.env['BASE_URL'] ?? 'http://localhost:38127';

test.use({ launchOptions: { args: fakeMicArgs('voice-en.wav') } });

test.describe.serial('voice input · speak a question, read it, send it', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    await initOwner(playwright);
  });

  test('speak, pause, and the question sends itself — no second press, no Enter', async ({ page }) => {
    test.setTimeout(120_000);
    expect(await voiceAvailable(page), 'the backend carries the speech model').toBe(true);
    await page.context().grantPermissions(['microphone']);
    await enterCodeSession(page, CODE);
    const mic = page.getByTestId('chat-mic');
    await expect(mic, 'the composer offers the mic').toBeVisible({ timeout: 20_000 });
    await mic.click();
    await expect(mic, 'it is recording').toHaveAttribute('data-state', 'recording');
    // The fake microphone plays the sentence, then 6 s of silence: the pause ends the recording.
    await expect(page.getByTestId('visitor-question').last(), 'the spoken words were asked')
      .toContainText(/quick brown fox/i, { timeout: 60_000 });
    await expect(page.getByTestId('answer-body').last(), 'and answered').not.toBeEmpty({ timeout: 30_000 });
    await expect(page.getByTestId('chat-input-field'), 'nothing left in the box').toHaveValue('');
  });

  test('the mic is a visible control that sits level with ASK', async ({ page }) => {
    await enterCodeSession(page, CODE);
    const mic = page.getByTestId('chat-mic');
    await expect(mic).toBeVisible({ timeout: 20_000 });
    const ask = await page.getByTestId('chat-input').getByRole('button', { name: /ask/i }).boundingBox();
    const m = await mic.boundingBox();
    const middle = (b: { y: number; height: number } | null) => (b === null ? NaN : b.y + b.height / 2);
    expect(Math.abs(middle(m) - middle(ask)), 'mic and ASK share one centre line (px)').toBeLessThanOrEqual(2);
    await expect(mic, 'it says what it is, not just a dot').toHaveText(/speak/i);
    const icon = await mic.locator('svg').boundingBox();
    expect(icon?.width ?? 0, 'a microphone glyph you can see').toBeGreaterThanOrEqual(14);
  });

  test('a Chinese recording comes back as Chinese words', async ({ page }) => {
    await enterCodeSession(page, CODE);
    const res = await transcribeFile(page.request, audioFile('voice-zh.wav'));
    expect(res.status, 'transcribed').toBe(200);
    expect(res.text, 'the Chinese words').toMatch(/天气/);
  });

  test('a recording over the cap is refused with a sentence', async ({ page }) => {
    await enterCodeSession(page, CODE);
    const res = await transcribeFile(page.request, Buffer.alloc(3 * 1024 * 1024, 1));
    expect(res.status, 'refused as too large').toBe(413);
    expect(res.message, 'says what to do').toMatch(/under a minute/i);
  });

  test('without a session the route refuses', async ({ playwright }) => {
    const stranger = await playwright.request.newContext({ baseURL: BASE });
    const res = await transcribeFile(stranger, audioFile('voice-en.wav'));
    expect(res.status, 'no session, no transcription').toBe(401);
    await stranger.dispose();
  });

});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, { code: CODE, label: 'voice' });
  await request.dispose();
}

async function voiceAvailable(page: Page): Promise<boolean> {
  const body = await (await page.request.get('/api/v1/voice')).json() as { available?: boolean };
  return body.available === true;
}
