// connector-agent-tool-names.spec.ts -- F-C-58: tool names exposed to the visitor AI
// must be names the provider will accept.
//
// In the neighboring spec (connector-agent-tools), every sample spec's operationId has
// the `contacts.list` dot shape, and the dot happens to be the only character that gets
// handled. In the real world, GitHub's whole REST API uses operationIds like
// `gists/list` / `repos/create-for-authenticated-user` -- **with slashes**.
//
// The provider constrains `tools[].name` to `^[a-zA-Z0-9_-]+$`, and **rejects the whole
// array together**: one illegal name and none of that turn's tools (booking, retrieval,
// sending mail) reach the model. Which means: an owner adds a connector shaped like
// this, and every tool in every visitor session on this instance goes dead on the
// spot -- triggered by one local, seemingly harmless action. This actually happened in
// prod: what the visitor got back as the answer was a line of raw
// `<tool_calls> github-gists </tool_calls>`.
//
// The mock gateway now enforces the same rule on names (mock-stack/llm-gateway/toolnames.go)
// -- it used to accept any name, so "are the names the product sends out legal" was
// never once measured by the e2e suite.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  AGENT_OWNER, MOCK_OAUTH2_SCHEME, createAndConnect, diagAgentCall,
  initOwner, sessionToolSpecs, startSession,
} from '@/fixtures/connector-agent-rig';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';

test.use({ ownerCredentials: { email: AGENT_OWNER.email, password: AGENT_OWNER.password } });

const SLASH_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Vendor With Slashes', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/crm' }],
  paths: {
    '/contacts': {
      get: {
        operationId: 'contacts/list',
        summary: 'List contacts',
        security: [{ oauth2: ['contacts.read'] }],
        responses: { '200': { description: 'contacts' } },
      },
    },
  },
  // Auth reuses what an already-green sample uses -- this test case is about **names**;
  // if the connection step were changed too, a failure would land on auth instead of names.
  components: { securitySchemes: MOCK_OAUTH2_SCHEME },
} as const;

// The provider's allowed character set for tool names. The assertion and the mock
// gateway enforce the same rule.
const PROVIDER_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

// The grant list isn't what this test case is about: unfixed code computes
// `op_contacts/list`, fixed code computes `op_contacts_list`. Grant both, so a failure
// lands on the name itself, not on "this op was never exposed".
const SLASH_OP_GRANTS = ['op_contacts/list', 'op_contacts_list'] as const;

test.describe('connector · agent-tool names must be provider-legal (F-C-58)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('an operationId with a slash still yields a callable tool — and does not poison the turn',
    async () => {
      const id = await createAndConnect(
        request, csrf, { spec: SLASH_SPEC, expose_as_agent_tools: true },
      );
      const session = await startSession(request, csrf, SLASH_OP_GRANTS);
      const specs = await sessionToolSpecs(request, session.session_token);
      const exposed = specs.map((t) => t.name).filter((n) => n.startsWith('op_'));

      // 1) The name must pass the provider's check. This is the defect itself.
      expect(exposed.length, 'the slashed operation is exposed at all').toBe(1);
      expect(exposed[0], 'exposed tool name is legal for the provider')
        .toMatch(PROVIDER_TOOL_NAME);

      // 2) Renaming must not break dispatch: the original operationId must still reach the SaaS.
      expect(await diagAgentCall(request, csrf, id, 'contacts/list', {}),
        'the original operationId still dispatches').toBe(200);

      // 3) This turn must actually produce an answer. Unfixed, the provider rejects the
      //    whole array, and the fallback path hands the model's raw `<tool_calls>` markup
      //    to the visitor as the answer (exactly what happened in prod).
      const tag = await scriptMockToolCall(request, { name: exposed[0]!, args: {} });
      const answer = await runVisitorChatTurn(request, session, `List the contacts${tag}`);
      expect(await answer.text(), 'the visitor is not shown tool-call markup')
        .not.toContain('<tool_calls>');
    });
});
