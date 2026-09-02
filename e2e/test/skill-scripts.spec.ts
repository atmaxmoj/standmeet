// skill-scripts.spec.ts —— Phase C / L3 (progressive disclosure's third tier):
// scripts referenced by a skill's body run on demand via **one generic
// `skill_run_script({name,script,args})` tool**, in a sandbox (docker
// isolation), returning only stdout/stderr/exit_code. **Replaces** the old
// eager model of "pre-expose every script as its own
// `skill_<name>_<script>` tool".
//
// Business story:
//   alice adds "marker-emitter" via skill_create: a bash script that does
//   `echo "[SANDBOX-MARKER]"`. Bound to MARKER-001; a recruiter chats with the
//   AI in a browser, the AI calls **skill_run_script** (script=run.sh) →
//   sandbox runs it → stdout=`[SANDBOX-MARKER]` gets packed into a
//   tool_result → the mock echoes [skill_result:...] back into the chat reply.
//
// scripted (not the natural path): skill_run_script needs {name,script} args,
// which the natural path can't feed → driven explicitly via scriptMockToolCall.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import type { APIRequestContext } from '@playwright/test';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'MARKER-001';
const SKILL_NAME = 'marker-emitter';
const SCRIPT_FILENAME = 'run.sh';
const MARKER = '[SANDBOX-MARKER]';

interface SkillCreateResp {
  id: string;
  name: string;
}

test.describe('owner-curated skill scripts run in docker sandbox', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await createSkillAndCode(request);
    await request.dispose();
  });

  test('L3: AI calls skill_run_script → sandbox runs the script → stdout in reply',
    async ({ browser, playwright }) => {
      // scripted: skill_run_script needs {name,script} args → drive the mock
      // explicitly, rather than gambling on the natural path (a generic tool
      // can't get the empty args the natural path would supply).
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, {
        name: 'skill_run_script',
        args: { name: SKILL_NAME, script: SCRIPT_FILENAME, args: {} },
      });
      const replyTag = await scriptMockReplyText(request, 'ran the marker for you');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`go ahead and run the marker${toolTag}${replyTag}`);
      await input.press('Enter');

      // Persistent signal: the reply contains the stdout marker from the docker
      // sandbox running the script, echoed back via skill_run_script's [skill_result:...].
      await expect(page.locator('[data-testid="answer-body"]'))
        .toContainText(MARKER, { timeout: 20_000 });

      await ctx.close();
    });
});

async function createSkillAndCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'b4-token');
  const sid = await initMCP(request, apiToken);
  const skill = await callTool<SkillCreateResp>(request, apiToken, sid, 'skill_create', {
    name: SKILL_NAME,
    prompt: 'When the visitor asks, call the marker tool and report its output.',
    description: 'Emits a recognizable sandbox marker.',
    scripts: [
      {
        filename: SCRIPT_FILENAME,
        language: 'bash',
        content: `echo "${MARKER}"`,
        description: 'Print the test marker to stdout.',
      },
    ],
  });
  await createCodeAttachingSkill(request, csrf, skill.id);
}

async function createCodeAttachingSkill(
  request: APIRequestContext, csrf: string, skillID: string,
): Promise<void> {
  // A.3-IAM-5: create a role with the skill attached, then issue a code referencing that role.
  const roleRes = await request.post('http://localhost:8000/api/admin/roles/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'sandbox-role',
      description: 'sandbox marker fixture role',
      prompt_id: null,
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
      skill_ids: [skillID],
      mcp_server_ids: [],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role failed: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const res = await request.post('http://localhost:8000/api/admin/codes/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code: CODE,
      label: 'Sandbox marker code',
      ghosts: [],
      assumed_role_id: role.id,
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create code failed: ${res.status()} ${await res.text()}`);
  }
}
