// connector-agent-tools.spec.ts — #155 §3's target contract (RED) for the second consumer
// path (agent = semantic read operations). Design "settled" this path but only noted in
// §7 "scheduled for later, no contract yet" — this file fills that gap.
//
// Two consumer paths (connector.md §3):
//   - Code consumer (booker/mailer/job-loop) -> normalized via a **category contract**:
//     the connector declares a category + maps operations onto the contract
//     (CalendarContract/MailContract). Existing contract coverage lives in
//     connector-binding-jsonata.spec.ts (section C).
//   - **agent (LLM) -> semantic read operations**: OpenAPI operations + their
//     descriptions are fed straight to the LLM, which reads and picks for itself
//     (MCP/GPT-Actions style). **No binding needed** — drop in a spec and it's usable by
//     the agent (§3 + §5.1 UML's right branch: "read operations / semantic self-selection
//     (no contract) / consume OpenAPI operations directly").
//
// This file pins down the agent path: an openapi connector (**without** a category
// binding, or beyond its binding) exposes its operations as agent **tools** — the LLM
// picks by an operation's summary/description. Assembled into the visitor session's tool
// set, with names/descriptions coming from the spec's operation summaries, kept distinct
// from category-contract caps.
//
// Covers the §9 agent-tool exposure subsystem (openapi operations -> per-session agent
// tools, runtime dialing the SaaS per-op with auth injected, sharing the same grant/ACL
// gate as caps). Implemented, all green (the original RED contract has flipped green).
//
// e2e never touches a real SaaS: the inlined spec's servers point at external-mock (the
// existing /__mock/gcal endpoint family; here /__mock/gcal/events is reused as the SaaS
// API landing point + /__mock/gcal/authorize|token for OAuth).
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ Assumptions (design left "how does an op become an agent tool" very light — each of
// these needs confirming at implementation time):
//
//  [A1] **The exposure-intent switch is `expose_as_agent_tools: true`**. Design only says
//       "drop in a spec and it's usable by the agent", without saying whether that's
//       on-by-default or opt-in. This file assumes a connector carries an explicit
//       `expose_as_agent_tools` flag at creation time — which also answers "does a
//       category-bound-only connector leak raw ops" (see [A5]). If the implementation
//       chose "expose by default for every openapi connector", drop the flag from the
//       happy-path cases and invert the [A5] case's assertion.
//
//  [A2] **tool name = `op_<operationId>` (snake_case, dots stripped)**. D-3 already
//       settled "URL <-> LLM spec 1:1, tool names snake_case" (see the agent-skills-grant.ts
//       comment: calendar.book -> calendar_book). This assumes operationId
//       `events.insert` -> agent tool `op_events_insert`. If the implementation uses a
//       different prefix (e.g. `<connector>__events_insert`) or keeps the dot, update
//       TOOL_NAME_FOR().
//
//  [A3] **tool description = the operation's `summary`** (falling back to `description`
//       when absent). MCP/GPT-Actions both use summary as the tool description the LLM
//       picks from. Assumes diag's tool_specs rows carry a description field.
//
//  [A4] **per-op ACL = agent-tool names listed in skill.allowed_tools** (the same gate as
//       caps). §3 says the agent path "needs no binding", but design's global principle
//       is "per-session grant/ACL is unified" (connector.md §6's DepRegistry single
//       global gate + memory: retrieval-vs-corpus-acl). Assumes an op can only be exposed
//       if (a) the connector is connected and (b) that session's role/skill grants this
//       agent-tool name. An ungranted op does not enter the tool set. If the
//       implementation chose connector-level granularity instead of per-op, downgrade the
//       PARTIAL_GRANT case to "the whole connector is granted or not".
//
//  [A5] **A category-only-bound connector does not leak raw ops**. Design §3 lists the
//       two paths side by side without saying whether installing a category binding on a
//       connector also auto-exposes its raw ops to the agent. This file assumes **no
//       auto-leak** — a category-bound connector only exposes its normalized category cap
//       to the agent (calendar_book), never the raw `op_*`, unless it also explicitly
//       carries `expose_as_agent_tools`. This assumption most needs confirming (see its
//       matching test case).
//
//  [A6] **The runtime entry point is diag `/api/admin/diag/connector/{id}/agent-call`**,
//       which dials the SaaS per op + args, injects auth, and returns the raw
//       (non-normalized) response — because the agent path has no contract and no
//       response JSONata, the LLM consumes the SaaS shape directly. Reuses
//       connector-binding's diag naming convention.
// ─────────────────────────────────────────────────────────────────────────────

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  AGENT_OWNER, MOCK_OAUTH2_SCHEME, createAndConnect, diagAgentCall,
  disconnectConnector, initOwner, sessionToolNames, sessionToolSpecs, startSession,
} from '@/fixtures/connector-agent-rig';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.use({ ownerCredentials: { email: AGENT_OWNER.email, password: AGENT_OWNER.password } });

// [A2] operationId -> agent-tool name mapping (dots stripped -> snake_case, `op_` prefix added).
function TOOL_NAME_FOR(operationId: string): string {
  return `op_${operationId.replace(/\./g, '_')}`;
}

// ─── inlined sample OpenAPI 3.0 spec (CRM-ish; servers -> mock SaaS) ───
// A minimal but valid 3.0 spec: three operationIds with summaries + one oauth2
// securityScheme. servers.url points at the e2e mock, so the runtime really hits the
// existing /__mock/gcal/events endpoint. Deliberately **not** the calendar category —
// this is the agent path, the connector declares no category, and the LLM picks by summary.
const AGENT_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Acme CRM', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/crm' }],
  paths: {
    '/contacts': {
      get: {
        operationId: 'contacts.list',
        summary: 'List CRM contacts',
        description: 'Return the owner\'s CRM contacts.',
        security: [{ oauth2: ['contacts.read'] }],
        responses: { '200': { description: 'contacts' } },
      },
    },
    '/contacts/search': {
      post: {
        operationId: 'contacts.search',
        summary: 'Search contacts by query',
        security: [{ oauth2: ['contacts.read'] }],
        responses: { '200': { description: 'matches' } },
      },
    },
    '/deals': {
      post: {
        operationId: 'deals.create',
        summary: 'Create a sales deal',
        security: [{ oauth2: ['deals.write'] }],
        responses: { '200': { description: 'created' } },
      },
    },
  },
  components: { securitySchemes: MOCK_OAUTH2_SCHEME },
} as const;

// agent-tool names for all three ops (used to assert happy-path exposure + distinguish
// from category caps).
const ALL_OP_TOOLS = [
  TOOL_NAME_FOR('contacts.list'),
  TOOL_NAME_FOR('contacts.search'),
  TOOL_NAME_FOR('deals.create'),
];

// ─── inlined calendar spec WITH a category binding ([A5] counterpart: a category-only
// connector must not leak raw ops) ───
// A calendar spec + binding isomorphic to connector-binding-jsonata.spec.ts's, but
// **without** expose_as_agent_tools — used to assert it only exposes the normalized cap
// (calendar_book), never leaking op_* raw tools.
const CALENDAR_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample Calendar', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/google-calendar' }],
  paths: {
    '/freeBusy': {
      post: {
        operationId: 'freebusy.query', summary: 'Query free/busy',
        security: [{ oauth2: ['calendar.readonly'] }],
        responses: { '200': { description: 'free/busy' } },
      },
    },
    '/events': {
      post: {
        operationId: 'events.insert', summary: 'Insert event',
        security: [{ oauth2: ['calendar.events'] }],
        responses: { '200': { description: 'created' } },
      },
    },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'http://localhost:9000/google-oauth/auth',
            tokenUrl: 'http://external-mock:9000/google-oauth/token',
            scopes: { 'calendar.readonly': 'read', 'calendar.events': 'write' },
          },
        },
      },
    },
  },
} as const;

const CALENDAR_BINDING = {
  category: 'calendar',
  kind: 'openapi',
  operations: {
    list_busy: {
      op: 'freebusy.query',
      request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{ "id": "primary" }] }',
      response: 'calendars.primary.busy.{ "start": start, "end": end }',
    },
    create_event: {
      op: 'events.insert',
      request: '{ "summary": title, "start": { "dateTime": start }, "end": { "dateTime": end } }',
      response: '{ "id": id, "url": htmlLink }',
    },
  },
} as const;

// raw op names the calendar connector would expose IF it leaked them (must NOT appear).
const CALENDAR_RAW_OP_TOOLS = [
  TOOL_NAME_FOR('freebusy.query'),
  TOOL_NAME_FOR('events.insert'),
];

// The "install -> connect -> authorize -> start session" rig lives in
// fixtures/connector-agent-rig.ts. It was pulled out because this file hit the 350-line
// gate, and the same rig now has a second user (connector-agent-tool-names.spec.ts).

test.describe('connector · agent-tool exposure (§3 second consumer path: agent = semantic read ops)', () => {
  // Covers the openapi operations -> per-session agent tools subsystem (design §3's
  // second consumer path). Implemented, green (was originally a RED contract).

  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  // happy: a connected openapi connector ([A1] expose_as_agent_tools) -> its operations
  // enter the session tool set, with names [A2] / descriptions [A3] coming from the
  // spec's operation summaries.
  test('connected openapi connector exposes its operations as agent tools (names + descriptions from spec summaries)',
    async () => {
      await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });
      const session = await startSession(request, csrf, ALL_OP_TOOLS);
      const specs = await sessionToolSpecs(request, session.session_token);
      const byName = new Map(specs.map((t) => [t.name, t]));

      // [A2] all three ops are exposed as agent tools.
      for (const name of ALL_OP_TOOLS) {
        expect(byName.has(name), `agent tool ${name} exposed`).toBe(true);
      }
      // [A3] description comes from the operation summary (the LLM picks by it semantically).
      expect(byName.get(TOOL_NAME_FOR('contacts.list'))?.description).toMatch(/list crm contacts/i);
      expect(byName.get(TOOL_NAME_FOR('deals.create'))?.description).toMatch(/create a sales deal/i);
    });

  // happy: op_* is a raw-op tool, distinct from a normalized category cap. No category
  // binding -> no calendar_book.
  test('agent tools are distinct from category-contract caps (raw ops, not a normalized category cap)',
    async () => {
      await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });
      const session = await startSession(request, csrf, ALL_OP_TOOLS);
      const names = await sessionToolNames(request, session.session_token);

      expect(names, 'raw op tools present').toEqual(expect.arrayContaining(ALL_OP_TOOLS));
      // No category binding -> no normalized category cap should show up at all.
      expect(names, 'no normalized category cap leaked from an agent-only connector')
        .not.toContain('calendar_book');
    });

  // happy: the agent (mock-llm-script) picks op_contacts_search (by summary) -> the
  // runtime injects auth and calls the SaaS ([A6] verified directly via diag) -> the raw
  // response goes back to the agent, and the turn doesn't crash.
  test('the agent invokes an agent tool → runtime calls the SaaS (auth-injected) → result returns to the agent',
    async () => {
      const id = await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });
      const session = await startSession(request, csrf, ALL_OP_TOOLS);

      // First prove the runtime path directly via diag (auth injected + a real hit on
      // the SaaS mock).
      const direct = await diagAgentCall(request, csrf, id, 'contacts.search', { query: 'rachel' });
      expect(direct, 'runtime executed the op against the SaaS').toBe(200);

      // Then go through the LLM script: the mock picks op_contacts_search, and the turn
      // doesn't crash. The script keyword is embedded in this one message (scriptTag);
      // the mock matches by Contains, so other tests' turns can't collide with it.
      const tag = await scriptMockToolCall(request, {
        name: TOOL_NAME_FOR('contacts.search'),
        args: { query: 'rachel' },
      });
      await sendAndDrain(request, session, `Find Rachel in the CRM${tag}`);
    });
});

test.describe('connector · agent-tool exposure · ACL/gating (§3 + §6 single global gate)', () => {
  // The same grant/ACL gate governs agent tools: per-op grant, a category-only connector
  // never leaks raw ops, and disconnecting makes it disappear.

  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  // ACL/gating [A4]: only contacts.list is granted; contacts.search / deals.create are
  // ungranted -> they don't enter the tool set.
  test('agent-tool exposure respects per-session grant/ACL (an ungranted op is not exposed)',
    async () => {
      await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });

      // Grant only the one agent tool contacts.list.
      const granted = [TOOL_NAME_FOR('contacts.list')];
      const session = await startSession(request, csrf, granted);
      const names = await sessionToolNames(request, session.session_token);

      expect(names, 'granted op exposed').toContain(TOOL_NAME_FOR('contacts.list'));
      expect(names, 'ungranted op not exposed').not.toContain(TOOL_NAME_FOR('contacts.search'));
      expect(names, 'ungranted op not exposed').not.toContain(TOOL_NAME_FOR('deals.create'));
    });

  // [A5] ⚠️ most needs confirming: a category-only-bound connector (no
  // expose_as_agent_tools) exposes only the normalized cap calendar_book, and never leaks
  // raw op_*. If design chose "openapi always exposes raw ops", invert the assertions below.
  test('a category-only connector does NOT leak raw ops as agent tools — only the category cap [ASSUMPTION A5]',
    async () => {
      // No expose_as_agent_tools — a category-only-bound connector.
      await createAndConnect(request, csrf, { spec: CALENDAR_SPEC, binding: CALENDAR_BINDING });

      // Grant the normalized category cap + its raw ops (if the implementation leaks
      // them, the raw ops will show up because they're granted -> the assertion catches it).
      const session = await startSession(request, csrf, ['calendar.book', ...CALENDAR_RAW_OP_TOOLS]);
      const names = await sessionToolNames(request, session.session_token);

      expect(names, 'normalized category cap present').toContain('calendar_book');
      for (const raw of CALENDAR_RAW_OP_TOOLS) {
        expect(names, `raw op ${raw} NOT leaked from a category-only connector`).not.toContain(raw);
      }
    });

  // ── err: connector disconnects -> its agent tools disappear (gated the same as any
  // other cap) ──
  // connected -> op_* exposed; disconnect -> all of them disappear via the single global
  // gate (dependency.connected=false).
  test('a disconnected connector — its agent tools disappear (gated like everything else)',
    async () => {
      const id = await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });

      // connected: exposed.
      const before = await startSession(request, csrf, ALL_OP_TOOLS);
      expect(await sessionToolNames(request, before.session_token))
        .toEqual(expect.arrayContaining(ALL_OP_TOOLS));

      // disconnect -> a new session has no agent tools at all (gated).
      await disconnectConnector(request, csrf, id);
      const after = await startSession(request, csrf, ALL_OP_TOOLS);
      const names = await sessionToolNames(request, after.session_token);
      for (const name of ALL_OP_TOOLS) {
        expect(names, `agent tool ${name} gated after disconnect`).not.toContain(name);
      }
    });
});
