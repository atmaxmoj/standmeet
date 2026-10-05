// voice-breath-pause.spec.ts —— a breath in the middle of a spoken question does not send it
// (owner 2026-10-04: "语音的间隔判断太短了，我说话都不敢喘气").
//
// The fake microphone plays a sentence, a 2-second pause (a breath and a thought), the sentence
// again, then 6 seconds of silence. The question that gets sent must hold BOTH halves: only the
// long silence at the end may end the recording.
//
// RED on v0.1.123: a 1.2 s pause ended the recording, so the question held the first half only.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { enterCodeSession } from '@/fixtures/navigate';
import { fakeMicArgs } from '@/fixtures/voice';

const OWNER = {
  email: 'voice-breath@example.com', password: 'correct-horse-battery-staple',
  handle: 'voicebreath', fullName: 'Voice Breath Owner',
};
const CODE = 'VOICEBREATH-01';

test.use({ launchOptions: { args: fakeMicArgs('voice-en-breath.wav') } });

test.describe('voice input · a breath does not end the question', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'voice breath' });
    await request.dispose();
  });

  test('both halves around a 2 s pause are in the question that is sent', async ({ page }) => {
    test.setTimeout(120_000);
    expect(await voiceAvailable(page), 'the backend carries the speech model').toBe(true);
    await page.context().grantPermissions(['microphone']);
    await enterCodeSession(page, CODE);
    const mic = page.getByTestId('chat-mic');
    await expect(mic, 'the composer offers the mic').toBeVisible({ timeout: 20_000 });
    await mic.click();
    await expect(mic, 'it is recording').toHaveAttribute('data-state', 'recording');
    const asked = page.getByTestId('visitor-question').last();
    // "jumps": the one word the speech model kept in both halves of every run. Its wording of the
    // joined recording varies around it ("The quick brown f jumps over the dog The quick brown f
    // jumps over the lazy dog.", "… over dog …", "The brown f jumps …").
    await expect(asked, 'the question was sent').toContainText(/jumps/i, { timeout: 60_000 });
    const words = await asked.innerText();
    const halves = words.match(/jumps/gi) ?? [];
    expect(halves.length, `both halves were kept; the question read: "${words}"`).toBe(2);
  });
});

async function voiceAvailable(page: Page): Promise<boolean> {
  const body = await (await page.request.get('/api/v1/voice')).json() as { available?: boolean };
  return body.available === true;
}
