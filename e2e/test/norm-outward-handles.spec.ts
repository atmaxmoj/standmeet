// norm-outward-handles.spec.ts —— the 【outward】 boundary: the block registry holds no owner_only
// entries at all.
//
// Outward handles = MCP tools StandMeet exposes to the owner where **StandMeet is the managed
// object itself** (the owner connects in from their own Claude Code / Desktop to manage
// StandMeet: codes, corpus, roles, the job loop…). Those never belonged in the block registry —
// that registry declares "what this instance's agent can load", a different axis. They live in the
// outbound choke point (backend/internal/routes/dispatcher), projected onto the MCP face from
// there; a tool the panel reaches by other routes says so with Reach = Only(reason, "mcp").
//
// This spec used to be a golden list of the owner_only entries still left, shrinking one line per
// move. The last three — jobs.bundle, resume.bundle, assistant.bundle — became dispatcher ops in
// refactor ledger R1 (layer2-externalize-jobs.md), so it is now the boundary assertion its old
// comment promised: zero owner_only entries. The tools themselves are still on the owner MCP face
// (norm-outward-toolset), and check-no-core-capability-fibers.sh holds the Go side.
// Inward blocks live in norm-inward-blocks.spec.ts — don't mix the two.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface Cap { id: string; shape: string; origin: string }
interface RegistryListResp { blocks: Cap[] }

test.describe('能力归一化 · 【对外】block registry 里没有 owner_only', () => {
  test.beforeAll(() => { resetInstance(); });

  test('the registry lists its blocks, and none of them is owner_only', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { blocks } = await fetchRegistry(request);
    // Read the list first: an empty answer would make "none is owner_only" true for nothing.
    expect(blocks.length, 'the registry answers with its blocks').toBeGreaterThan(0);
    expect(blocks.filter((c) => c.shape === 'owner_only'), 'owner tools live in the dispatcher')
      .toEqual([]);
    await request.dispose();
  });
});

async function fetchRegistry(request: APIRequestContext): Promise<RegistryListResp> {
  const res = await request.get(`${BACKEND}/internal/diag/registry`);
  if (res.status() !== 200) {
    throw new Error(`diag/registry: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as RegistryListResp;
}
