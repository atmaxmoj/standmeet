// voice.ts —— helpers for voice input specs (docs/design/voice-input.md).
//
// The browser half is driven for real: Chromium's fake microphone plays a recorded sentence
// (fakeMicArgs). These helpers cover what a browser cannot set up: a recording sent straight to
// the transcribe route (a second language without a second browser, an over-cap upload), and the
// speech service taken away and brought back through the Makefile.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { APIRequestContext } from '@playwright/test';

const AUDIO_DIR = path.resolve(__dirname, 'audio');

// fakeMicArgs —— Chromium flags: grant the mic without a prompt and play this WAV as its input.
export function fakeMicArgs(wav: string): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${path.join(AUDIO_DIR, wav)}`,
  ];
}

// transcribeFile —— send a recording to POST /api/v1/transcribe as the composer does (multipart
// "audio"), with whatever session cookie the request context carries.
export async function transcribeFile(
  request: APIRequestContext, bytes: Buffer, filename = 'speech.wav',
): Promise<{ status: number; text: string; message: string }> {
  const res = await request.post('/api/v1/transcribe', {
    multipart: { audio: { name: filename, mimeType: 'audio/wav', buffer: bytes } },
  });
  const body = await res.json() as { text?: string; error?: { message?: string } };
  return { status: res.status(), text: body.text ?? '', message: body.error?.message ?? '' };
}

export function audioFile(name: string): Buffer {
  return readFileSync(path.join(AUDIO_DIR, name));
}

// setSpeechService —— stop or start the bundled stt service (the Makefile is the one docker entry).
export function setSpeechService(up: boolean): void {
  execSync(`make -C .. ${up ? 'dev-start-svc' : 'dev-stop-svc'} SVC=stt`, { stdio: 'inherit' });
}
