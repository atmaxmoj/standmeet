// norm-inward-capabilities.spec.ts —— the 【inward】 capability golden snapshot
// (normalization safety net).
//
// Inward capabilities = capabilities loaded into the agent for **visitor AI** use, i.e.
// **visitor-facing**: shape is visitor_only or both. The criterion matches the backend's one
// and only shape gate (capreg.VisitorCapabilityIDs: Shape() != owner_only) — a capability
// also serving the owner side (booker exposes calendar.list_slots via manifest.OwnerTools)
// does not drop out of the inward snapshot because of that; using `=== 'visitor_only'` as the
// criterion would silently let it fall out of coverage. This is exactly what this round of
// "capability normalization" migrates: externalizing these builtins from in-process Go into
// standard MCP servers (box (B) in the architecture diagram). The loading mechanism
// changes, but the id / origin / order the diag/registry sees stays the same.
//
// **This locks down inward only**. Outward self-managed MCP handles live in
// norm-outward-handles.spec.ts — don't mix the two.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface Cap { id: string; shape: string; origin: string }
interface RegistryListResp { capabilities: Cap[] }

// GOLDEN (inward) — registration order pinned entry by entry; even after externalization it
// still reports origin=builtin (shipped with the build). echoer is the externalized visitor
// plugin discovered via STANDMEET_PLUGINS (managed), already the "externalized template".
// ask_visitor has been externalized into its own module, loaded by the composition root
// in-process through the unified plugin path with origin=builtin (after
// RegisterVisitorSkills) → its registration slot moves to after summarize_conversation, and
// before echoer (a managed third party). id/shape/origin unchanged.
const GOLDEN_INWARD: readonly Cap[] = [
  // skill.runner + ext.mcp are loaders/mechanisms (not leaf capabilities), left in capreg's
  // builtin registration slot.
  { id: 'skill.runner', shape: 'visitor_only', origin: 'builtin' },
  { id: 'ext.mcp', shape: 'visitor_only', origin: 'builtin' },
  // connector.agent_tools — once an openapi connector turns on expose_as_agent_tools, its
  // raw operations get exposed as per-session agent tools (Shape=VisitorOnly, registered at
  // boot; whether a given visitor can actually see it is decided per-session by
  // SessionGate). Landed as part of the connector refactor #155 §3, registered after
  // ext.mcp and before the leaf capabilities.
  { id: 'connector.agent_tools', shape: 'visitor_only', origin: 'builtin' },
  // resume.read — the recruiter reads THIS application's tailored résumé by code (job loop B-7).
  // In-host (capreg_resume_read.go), loaded before the sandboxed leaf plugins below, hence here.
  { id: 'resume.read', shape: 'visitor_only', origin: 'builtin' },
  // ask_visitor + summarize_conversation + calendar.book + corpus.retrieval — all four leaf
  // capabilities are externalized into sandboxed plugins (mcp-servers/*), loaded through
  // registerBuiltins via the unified sandbox_stdio path with origin=builtin (after the
  // capreg loader, before any managed third party). No capability-specific MCP code remains
  // in the main app. id/shape/origin unchanged, only the loading mechanism changed.
  // calendar.book additionally layers a SessionGate (connector+quota) for per-session hiding.
  //
  // **These five are ordered by id**, because once the declaration moved into
  // backend/capabilities/<id>/manifest.yaml, load order became directory order, and
  // directory order is id order. The old order was whatever sequence someone happened to
  // pack them into a Go slice — a reasonless order that anyone reordering the slice could
  // silently change. Now it's derived from id, and can't drift: changing the order requires
  // changing the id, and the id is the public-facing name.
  { id: 'ask_visitor', shape: 'visitor_only', origin: 'builtin' },
  // calendar.book — shape=both: visitor side is calendar_book / calendar_list_slots, owner
  // side is calendar.list_slots (manifest.OwnerTools, same sandboxed implementation). There
  // is exactly one copy of the policy evaluation + slot enumeration.
  { id: 'calendar.book', shape: 'both', origin: 'builtin' },
  { id: 'corpus.retrieval', shape: 'visitor_only', origin: 'builtin' },
  // mail.send — the send operation exposed by the built-in SMTP connector's
  // expose_as_agent_tools (visitor-side "booking succeeded → send confirmation email" #122).
  // Same as connector.agent_tools: Shape=VisitorOnly + per-session gate.
  { id: 'mail.send', shape: 'visitor_only', origin: 'builtin' },
  { id: 'summarize_conversation', shape: 'visitor_only', origin: 'builtin' },
  { id: 'echoer', shape: 'visitor_only', origin: 'managed' },
  // everything / fsmcp — genuine third-party MCP servers (the @modelcontextprotocol official
  // reference servers), loaded inside bwrap isolation via sandbox_stdio (declared through
  // STANDMEET_PLUGINS, managed). Proves the unified loader also works for servers "we didn't
  // write", and that the sandbox confinement is real.
  { id: 'everything', shape: 'visitor_only', origin: 'managed' },
  { id: 'fsmcp', shape: 'visitor_only', origin: 'managed' },
  // wsfs — server-filesystem rooted at /workspace (sandbox.workspace=true): runs the
  // per-session workspace TTL/cron lifecycle (#148). Reuses the fsmcp code, managed.
  { id: 'wsfs', shape: 'visitor_only', origin: 'managed' },
  // netfetch / cagedfetch — the same real fetch server (mcp-server-fetch); the only
  // difference is sandbox network policy: netfetch allows egress, cagedfetch runs
  // --network=none. Verifies network confinement in both directions.
  { id: 'netfetch', shape: 'visitor_only', origin: 'managed' },
  { id: 'cagedfetch', shape: 'visitor_only', origin: 'managed' },
  // escapee — an adversarial plugin: server-filesystem rooted at /, built specifically to
  // actively attempt escape (reading docker.sock / host config / path traversal), proving
  // bwrap blocks all of it.
  { id: 'escapee', shape: 'visitor_only', origin: 'managed' },
];

test.describe('能力归一化 · 【对内】agent 能力黄金快照', () => {
  test.beforeAll(() => { resetInstance(); });

  test('inward(visitor-facing)能力的 id + shape + origin + 顺序逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const inward = (await fetchRegistry(request))
        .capabilities.filter((c) => c.shape !== 'owner_only');
      expect(inward).toEqual(GOLDEN_INWARD);
      await request.dispose();
    });

  test('多次拉取顺序稳定(prompt hash 依赖注册顺序)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const a = (await fetchRegistry(request)).capabilities.map((c) => c.id);
      const b = (await fetchRegistry(request)).capabilities.map((c) => c.id);
      expect(b).toEqual(a);
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
