// visitor-chat-throbber-label.spec.ts —— the throbber reflects the agent's
// real-time behavior: it's a 1:1 view of tool_started events on the
// /agent/turn SSE stream (a single value, each new one replacing the last).
// The throbber's copy = the progress_label registered by the backend for each
// tool, plus, for a corpus read, "which document is being read" layered on top
// (throbber-label.ts).
//
// Verification: **hook an SSE response listener before asking the question**,
// recording the entire /agent/turn stream — every step the agent takes really
// does flow over the network regardless of whether React paints it (in a
// zero-latency mock turn the intermediate frames get batched away and the DOM
// never gets a chance to paint them, but the event stream doesn't drop a
// single one). Assert the stream emits, in order, corpus_search (carrying the
// backend's progress_label) → corpus_read (args.path = the document being
// read) — this is exactly the source of what the throbber displays frame by frame.
//
// The throbber's "single value, never stacks" property is a structural
// guarantee (use-chat's currentTool is a single value, stacking is impossible
// by type); "clears the instant the turn lands" is covered separately by
// visitor-chat-throbber-clears.

import { test, expect } from '@/fixtures/test';
import type { Response } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';

interface ToolStarted {
  name: string;
  path: string;
  progressLabel: string;
}

test.describe('throbber label 走 backend BindingTool.ProgressLabel registry', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'throbber-label-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'throbber-label spec',
    });
    await request.dispose();
  });

  test('agent 按序 emit corpus_search → corpus_read(带 progress_label + 在读的 document)',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Hook the listener before asking the question: records the entire
      // /agent/turn SSE. The event stream is never batched away by React —
      // transient or zero-latency, every step the agent takes is in there.
      const turnRespPromise = page.waitForResponse(
        (r) => r.url().includes('/agent/turn') && r.status() === 200,
        { timeout: 20_000 },
      );

      // Mock is pure registration + ordered emission: register corpus_search THEN
      // corpus_read → the agent stream emits them in that order (what the throbber
      // reflects). read path = the seeded document.
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: TARGET_PATH },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${searchTag}${readTag}`);
      await input.press('Enter');

      const started = await collectToolStarted(await turnRespPromise);

      const search = started.find((t) => t.name === 'corpus_search');
      const read = started.find((t) => t.name === 'corpus_read');
      // corpus_search appeared, carrying the backend-registered progress_label (the throbber's default copy source).
      expect(search).toBeDefined();
      expect(search?.progressLabel ?? '').not.toBe('');
      // corpus_read appeared, args.path = the document being read (owner's question: "what exactly is it reading").
      expect(read).toBeDefined();
      expect(read?.path).toBe(TARGET_PATH);
      // Order: search first, then read.
      expect(started.findIndex((t) => t.name === 'corpus_search'))
        .toBeLessThan(started.findIndex((t) => t.name === 'corpus_read'));

      await ctx.close();
    });
});

// collectToolStarted —— reads the entire SSE (stream ends = turn landed),
// extracting all tool_started frames: event: tool_started / data: {name,args,progress_label}.
async function collectToolStarted(resp: Response): Promise<ToolStarted[]> {
  const raw = await resp.text();
  const out: ToolStarted[] = [];
  for (const block of raw.split('\n\n')) {
    const frame = parseFrame(block);
    if (frame === null || frame.event !== 'tool_started') continue;
    out.push(frameToToolStarted(frame.data));
  }
  return out;
}

function parseFrame(block: string): { event: string; data: string } | null {
  let event = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) data = line.slice(6).trim();
  }
  return event === '' ? null : { event, data };
}

function frameToToolStarted(data: string): ToolStarted {
  const d = safeRecord(data);
  const args = isRecord(d['args']) ? d['args'] : {};
  return {
    name: strOf(d['name']),
    path: strOf(args['path']),
    progressLabel: strOf(d['progress_label']),
  };
}

function safeRecord(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s);
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
