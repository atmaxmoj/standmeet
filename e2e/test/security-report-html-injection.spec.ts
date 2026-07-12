// security-report-html-injection.spec.ts —— RED repro (bug hunt #5, MED). summarize_conversation
// takes the model's output as the report HTML (usecases/capreg_summarize_conversation.go
// generateReportHTML) and wrapReportHTML (routes/public/report_pdf.go) embeds it VERBATIM — the
// "no script/style/iframe" rule is only a prompt instruction, never enforced. The report is then
// (a) rendered by network-enabled Gotenberg Chromium (its own CSS @imports Google Fonts, proving
// net is on) → server-side SSRF, and (b) shown to owner/visitor in a srcDoc iframe → client-side
// fetch. A visitor who steers the model to emit `<img src=http://169.254.169.254/…>` gets the
// server (and owner's browser) to fetch an internal/attacker URL.
//
// Boundary: model/visitor-derived report HTML must be sanitized (external-resource-loading tags
// neutralized) before it is stored/embedded. Positive control: benign body survives. GREEN =
// sanitized; currently RED — the injected internal URL is served back verbatim.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'reportsec-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'reportsec',
  fullName: 'Report Sec Owner',
};
const CODE = 'RPT-001';
const METADATA_IP = '169.254.169.254';

// the model output steered by a hostile visitor: a benign heading (positive control) plus an
// internal-resource-loading <img> + <link> the network-enabled renderer would fetch.
const MALICIOUS_REPORT_HTML = [
  '<h1>Quick recap</h1>',
  `<img src="http://${METADATA_IP}/latest/meta-data/">`,
  `<link rel="stylesheet" href="http://${METADATA_IP}/x.css">`,
  '<p>Visitor and assistant discussed weekend hike plans.</p>',
].join('');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('security · report HTML must be sanitized before render (no SSRF)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'rpt-role', description: 'report sec', corpus_uris: ['wiki://**', 'output://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'rpt', assumed_role_id: role.id });
    await request.dispose();
  });

  test('injected internal <img>/<link> in the report is stripped, not served verbatim', async ({
    playwright,
  }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
    const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
    const replyTag = await scriptMockReplyText(request, MALICIOUS_REPORT_HTML);
    const turn = await request.post(`${BACKEND}/api/v1/agent/turn`, {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: { system: 'You are the owner.', user_message: `recap please${toolTag}${replyTag}`,
        conversation_id: sess.conversation_id },
    });
    const sse = await turn.text();
    const reportID = (sse.match(/\\"report_id\\":\\"([0-9a-f-]{36})\\"/)
      ?? sse.match(/"report_id":"([0-9a-f-]{36})"/))?.[1] ?? '';
    expect(reportID, `summarize produced a report id; SSE:\n${sse}`).toBeTruthy();

    const r = await request.get(`${BACKEND}/api/v1/report/${reportID}`, {
      headers: { Authorization: `Bearer ${sess.session_token}` },
    });
    expect(r.status()).toBe(200);
    const html = (await r.json() as { html: string }).html;
    expect(html, 'benign report body survives (real render, not empty)').toContain('Quick recap');
    expect(html, 'internal-resource URL must be stripped before render (SSRF)')
      .not.toContain(METADATA_IP);
    await request.dispose();
  });
});
