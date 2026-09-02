// resume-enters-the-conversation.spec.ts —— the fix for "简历进不了对话".
//
// A recruiter scans the résumé QR and lands in a visitor session under the application's
// auto-issued hiring code. This proves, end-to-end, that the recruiter's agent can then reach THIS
// application's tailored résumé:
//   1. the `resume_read` tool is in the session's exposed tool set (the agent DISCOVERS it — no
//      prompt tells it résumés exist; the tool's own presence + description is the whole signal);
//   2. calling it through the real agent loop runs the real GetApplicationByAccessCode query and
//      returns a non-empty result (the résumé content actually reaches the conversation).
//
// The content itself is NOT asserted here on purpose: the transcript strips tool results (they hold
// private data) and the log records only result_bytes. The content-level "which application, and
// never another's" guarantee is proven where the return value is readable — the Go test
// (cap_resume_visitor_test.go). This spec proves the wiring + the real query path.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, backendLogTail } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import {
  applicationsCommit, resumeDraft, sampleResumeContent, type CommittedApplication,
} from '@/fixtures/resume';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames } from '@/fixtures/capabilities';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'resume-conv@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumeconv', fullName: 'Resume Conversation Owner',
};

const RESUME_TOOL = 'resume_read';

// commitApplication —— the whole job-loop commit chain, returning the committed application (its
// auto-issued access code is `view.access_code`). Same shape recruiters land on after a QR scan.
async function commitApplication(request: APIRequestContext): Promise<CommittedApplication> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'resume-conv');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
  });
  const fetched = await jobsFetchNew(request, token, sid, src.id);
  expect(fetched.jobs[0]).toBeDefined();
  const drafted = await resumeDraft(
    request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent(),
  );
  return applicationsCommit(request, token, sid, drafted.view.draft_id);
}

// resumeDoneBytes —— the result_bytes on the `agent tool done` line for resume_read, or -1 if the
// tool never produced a result. Proves the tool actually ran through the real backend dispatch.
function resumeDoneBytes(log: string): number {
  const line = log.split('\n').reverse().find(
    (l) => l.includes('"agent tool done"') && l.includes(`"${RESUME_TOOL}"`),
  );
  if (!line) return -1;
  const m = line.match(/"result_bytes":\s*(\d+)/);
  return m ? Number(m[1]) : -1;
}

test.describe('a recruiter session can read this application’s résumé', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the résumé tool is exposed and returns content in the application’s code session',
    async ({ request }) => {
      const committed = await commitApplication(request);
      const code = committed.view.access_code;
      expect(code, 'the commit issued a hiring code').toBeTruthy();

      // The recruiter lands here via the QR — a normal code session, no special setup.
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Recruiter Rachel',
      });

      // (1) The agent discovers the tool: it is in the session's exposed tool set.
      const tools = await sessionToolNames(request, sess.session_token);
      expect(tools, 'the recruiter agent is offered the résumé tool').toContain(RESUME_TOOL);

      // (2) Calling it through the real loop runs GetApplicationByAccessCode and returns content.
      const tag = await scriptMockToolCall(request, { name: RESUME_TOOL, args: {} });
      await sendAndDrain(request, sess, `What does the candidate emphasise for this role?${tag}`);

      const bytes = resumeDoneBytes(backendLogTail());
      expect(bytes, 'resume_read ran end-to-end and returned a non-empty résumé').toBeGreaterThan(0);
    });
});
