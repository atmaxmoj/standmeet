// voice-input.spec.ts —— a visitor speaks a question instead of typing it
// (docs/design/voice-input.md; owner 2026-09-30 "服务器端转写吧", 2026-10-01 "语音输入，你就做吧").
//
// Real stack, real model: the backend runs SenseVoice in process (internal/infra/stt). Chromium's
// fake microphone plays a recorded English sentence; the visitor presses the mic, stops, and the
// words land in the input box — not sent: the visitor reads and sends. A Chinese recording goes
// through the same route. The caps and the session check refuse with a sentence.
//
// RED on the code of 2026-10-01: there is no mic, no /transcribe and no /voice.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
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

  test('the mic turns a spoken English sentence into text in the input box, then it sends', async (
    { page, playwright },
  ) => {
    test.setTimeout(120_000);
    expect(await voiceAvailable(page), 'the backend carries the speech model').toBe(true);
    await page.context().grantPermissions(['microphone']);
    await enterCodeSession(page, CODE);
    await speakIntoMic(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input, 'the words land in the input box').toHaveValue(/quick brown fox/i, { timeout: 60_000 });
    await sendAndExpect(page, playwright, 'VOICE_ANSWER_3');
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

// speakIntoMic —— press the mic, let the fake microphone play the sentence (≈3 s, read off the
// recording timer rather than a sleep), press it again.
async function speakIntoMic(page: Page): Promise<void> {
  const mic = page.getByTestId('chat-mic');
  await expect(mic, 'the composer offers the mic').toBeVisible({ timeout: 20_000 });
  await mic.click();
  await expect(mic, 'it is recording').toHaveAttribute('data-state', 'recording');
  await expect(page.getByTestId('chat-mic-timer'), 'the timer runs').toHaveText(/0:0[4-9]/, { timeout: 15_000 });
  await mic.click();
}

// sendAndExpect —— send what is in the input and wait for the scripted answer.
async function sendAndExpect(page: Page, playwright: Playwright, marker: string): Promise<void> {
  const request = await playwright.request.newContext();
  const reply = await scriptMockReplyText(request, `Answer ${marker}.`);
  await request.dispose();
  const input = page.getByTestId('chat-input-field');
  await input.fill(`${await input.inputValue()}${reply}`);
  await input.press('Enter');
  await expect(page.getByTestId('answer-body').last(), 'the question got an answer')
    .toContainText(marker, { timeout: 30_000 });
}

async function voiceAvailable(page: Page): Promise<boolean> {
  const body = await (await page.request.get('/api/v1/voice')).json() as { available?: boolean };
  return body.available === true;
}
