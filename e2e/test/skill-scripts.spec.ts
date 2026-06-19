// skill-scripts.spec.ts —— Phase C / L3（progressive disclosure 第三级）：
// skill 正文引用的脚本经 **一个通用 `skill_run_script({name,script,args})`
// tool** 按需跑 sandbox（docker 隔离），只回 stdout/stderr/exit_code。**替换**
// 旧的「每个 script 预先暴露成 `skill_<name>_<script>` tool」eager 模型。
//
// 业务故事：
//   alice 用 skill_create 加 "marker-emitter"：一段 bash `echo "[SANDBOX-MARKER]"`。
//   绑到 MARKER-001；recruiter 在浏览器跟 AI 聊，AI 调 **skill_run_script**
//   （script=run.sh）→ sandbox 跑 → stdout=`[SANDBOX-MARKER]` 打包进 tool_result
//   → mock 把 [skill_result:...] echo 回 chat reply。
//
// scripted（非自然路径）：skill_run_script 要 {name,script} 入参，自然路径喂不了
// → 用 scriptMockToolCall 显式驱动。

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
  skill_id: string;
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
      // scripted：skill_run_script 要 {name,script} 入参 → 显式驱动 mock，
      // 而不是赌自然路径（通用 tool 拿不到自然路径塞的空 args）。
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'skill_run_script',
        args: { name: SKILL_NAME, script: SCRIPT_FILENAME, args: {} },
      });
      await scriptMockReplyText(request, 'ran the marker for you');
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
      await input.fill('go ahead and run the marker');
      await input.press('Enter');

      // 持久信号:reply 里含 docker sandbox 跑脚本的 stdout marker，经
      // skill_run_script 的 [skill_result:...] echo 回来。
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
  await createCodeAttachingSkill(request, csrf, skill.skill_id);
}

async function createCodeAttachingSkill(
  request: APIRequestContext, csrf: string, skillID: string,
): Promise<void> {
  // A.3-IAM-5: 建一个 role 挂 skill，再发码引用 role。
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
