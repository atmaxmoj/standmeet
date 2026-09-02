// norm-outward-handles.spec.ts —— the 【outward】 self-managed MCP handles golden
// snapshot.
//
// Outward handles = MCP tools StandMeet exposes to the owner where **StandMeet is the
// managed object itself** (the owner connects in from their own Claude Code / Desktop
// to manage StandMeet: manage codes, edit the corpus, configure roles, and so on;
// Shape=owner_only). This is StandMeet's **as-MCP-server direction**, and is **not** a
// capability loaded into the agent — **this round of normalization does not touch
// it**.
//
// This is locked down here to prove "normalization only touches inward capabilities,
// and never accidentally hits this batch of outward handles".
// Inward capabilities live in norm-inward-capabilities.spec.ts — don't mix the two.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface Cap { id: string; shape: string; origin: string }
interface RegistryListResp { capabilities: Cap[] }

// GOLDEN (outward) — all owner_only, untouched by this round, origin all builtin.
// Note: jobs/resume/applications also belong here — they're owner-facing
// self-managed MCP, the same category as codes/seo, not inward capabilities.
//
// **This golden list will shrink as ownercore gets dissolved.** An owner's
// self-managed tools were never meant to register into capreg in the first place
// (capreg is the declarative registry for "what this instance's agent can load" —
// a different axis entirely); they're being moved into the outbound choke point
// (backend/internal/routes/dispatcher), projected onto the MCP surface from there.
// Move one out, delete one line here. Once it's empty, this golden list flips into a
// boundary assertion: capreg should have **no** owner_only entries at all.
//
// Already moved (-> dispatcher): ip_bans, domains, access_requests, skills,
// marketplace, prompts, mcp_servers, roles, capabilities, instance, appearance,
// account/me, byoai + ai_provider, seo, page, custom_page, chat,
// corpus.subjectivity, api_keys, connectors (the generic registry belongs to the
// connector axis; mail_test_send belongs to the smtp connector's own manifest), and
// the four corpus operations (genre collapsed from three tool sets into one
// parameter, filling in the four cells MCP used to be missing along the way).
// booking's policy goes a step further: it's the booker externalized capability's
// own configuration, going through the generic capability_config surface.
//
// writings was moved too (ownercore was deleted along with it). The reason it was
// originally kept here said "a byte stream can't fit into a JSON op", and that
// reasoning was wrong: the MCP path has only ever taken a string of https URLs, and
// the server fetches them itself. What genuinely couldn't be moved was **merging two
// surfaces into one op** (the panel uses multipart), so writing_create now lives in
// the corpus domain with Reach = Only(reason, "mcp") — the difference is written into
// the declaration, instead of hiding a package outside the choke point.
//
// So this golden list is down to just the three jobs plugin entries.
// **Once all three are moved out**, this golden list flips into a boundary
// assertion: capreg should have **no** owner_only entries at all.
const GOLDEN_OUTWARD: readonly Cap[] = [
  { id: 'jobs.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'resume.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'applications.bundle', shape: 'owner_only', origin: 'builtin' },
];

test.describe('能力归一化 · 【对外】自管理 MCP handles 黄金快照(本次不碰)', () => {
  test.beforeAll(() => { resetInstance(); });

  test('outward(owner_only)handles 的 id + origin + 顺序逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const outward = (await fetchRegistry(request))
        .capabilities.filter((c) => c.shape === 'owner_only');
      expect(outward).toEqual(GOLDEN_OUTWARD);
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
