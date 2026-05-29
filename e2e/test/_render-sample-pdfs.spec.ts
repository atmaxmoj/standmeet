// _render-sample-pdfs.spec.ts —— writes a sample committed PDF to /tmp
// and opens it so we can eyeball the gotenberg-rendered output. Filename
// prefixed `_` so it sorts apart from real specs; not part of the green
// suite — run with `make test-only SPEC=_render-sample-pdfs`.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import {
  applicationsCommit, resumeDraft, sampleResumeContent,
} from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('render sample PDFs to /tmp', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('write committed PDF + open', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'sample-render');
    const sid = await initMCP(request, token);
    const source = await jobsRegisterSource(request, token, sid, {
      kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
    });
    const fetched = await jobsFetchNew(request, token, sid, source.id);
    const first = fetched.jobs[0];
    expect(first).toBeDefined();
    const drafted = await resumeDraft(
      request, token, sid, first!.cache_id, sampleResumeContent(),
    );
    const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);
    const out = '/tmp/sample-resume-committed.pdf';
    writeFileSync(out, committed.pdf);
    process.stdout.write(`committed: ${out} (${committed.pdf.length} bytes)\n`);
    process.stdout.write(`qr_url: ${committed.view.qr_url}\n`);
    execSync(`open ${out}`);
  });
});
