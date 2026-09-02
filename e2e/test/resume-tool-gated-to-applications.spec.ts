// resume-tool-gated-to-applications.spec.ts —— the gate, both sides on one instance.
//
// The résumé tool must appear ONLY in a session whose code was issued by applications.commit (i.e.
// resolves to an application). An ORDINARY access code — the everyday /gate visitor path — must not
// see it. If the tool leaked onto plain codes it would be exposed by nothing more than "you have a
// code", and the whole point (a code carries no résumé; résumés stay in the job-loop domain) breaks.
//
// Both sides run against the same instance so the negative is anchored by a positive: the SAME
// build exposes resume_read for the application code and hides it for the plain code. That rules out
// "absent because nothing assembled" — the feature is provably capable of exposing it here.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames } from '@/fixtures/capabilities';

const OWNER = {
  email: 'resume-gate@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumegate', fullName: 'Resume Gate Owner',
};

const RESUME_TOOL = 'resume_read';
const PLAIN_CODE = 'PLAIN-VISITOR';

// commitApplicationCode —— run the commit chain, return the auto-issued application code.
async function commitApplicationCode(request: APIRequestContext, csrf: string): Promise<string> {
  const token = await createAPIToken(request, csrf, 'resume-gate');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
  });
  const fetched = await jobsFetchNew(request, token, sid, src.id);
  expect(fetched.jobs[0]).toBeDefined();
  const drafted = await resumeDraft(
    request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent(),
  );
  const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);
  return committed.view.access_code;
}

test.describe('the résumé tool is gated to application codes', () => {
  test.describe.configure({ timeout: 120_000 });
  let appCode = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'plain-role', description: 'wiki', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: PLAIN_CODE, label: 'plain', assumed_role_id: role.id });
    appCode = await commitApplicationCode(request, csrf);
    await request.dispose();
  });

  test('exposed on the application code, hidden on an ordinary code', async ({ request }) => {
    // Positive anchor: the application session IS offered the tool (so the build can expose it here).
    const appSess = await issueSession(request, {
      handle: OWNER.handle, mode: 'code', code: appCode, visitor_name: 'Recruiter',
    });
    expect(await sessionToolNames(request, appSess.session_token),
      'the application session is offered the résumé tool').toContain(RESUME_TOOL);

    // The gate: an ordinary code, same instance, must NOT see it.
    const plainSess = await issueSession(request, {
      handle: OWNER.handle, mode: 'code', code: PLAIN_CODE, visitor_name: 'Ordinary Visitor',
    });
    expect(await sessionToolNames(request, plainSess.session_token),
      'a plain code must not see the résumé tool').not.toContain(RESUME_TOOL);
  });
});
