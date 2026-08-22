// ai-provider-config.spec.ts —— owner 在 /admin/api-mcp 配置自己的 AI
// provider + key。明文 key 不回读；toast 反馈成功。
//
// Phase 1 只验"key 能存能清，UI 状态切换正确"。Phase 2 跑 visitor 真聊
// 走 Anthropic 路径在后续 spec 里。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner configures AI provider + key from /admin/api-mcp', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('pick anthropic + paste key → key set; clear → mock + key gone',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');

      await page.getByTestId('ai-provider-anthropic').click();
      // endpoint 切 provider 时 preset 默认填好；model 必须手输（没有 default）。
      await page.getByTestId('ai-provider-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('ai-provider-key').fill('sk-ant-fake-test-key');
      await page.getByTestId('ai-provider-save').click();
      await expect(page.getByTestId('toast-success').filter({ hasText: 'AI provider saved' }))
        .toBeVisible();
      // 重新 load 一遍 panel，看 key_configured 状态进来 (placeholder 切换)。
      await page.reload();
      await expect(page.getByTestId('ai-provider-key'))
        .toHaveAttribute('placeholder', /already set/);
      // #33:model 从 SoT(/me)回填,不是 preset 默认/空 —— owner 看到自己存的值。
      await expect(page.getByTestId('ai-provider-model'))
        .toHaveValue('claude-haiku-4-5-20251001');

      await page.getByTestId('ai-provider-clear').click();
      await expect(page.getByTestId('toast-success').filter({ hasText: 'AI provider cleared' }))
        .toBeVisible();
      await expect(page.getByTestId('ai-provider-clear')).toHaveCount(0);
    });

  // F-R-9 —— **owner 指着自己的自托管端点，必须能选模型。**
  //
  // 这张卡自己写着支持什么：*"point at your own self-hosted OpenAI-compatible endpoint
  // (ollama / vllm / lm-studio)"* —— 而这三样**都跑在私有地址上**（ollama 默认
  // `localhost:11434`）。今天点 `LOAD MODELS` 收到的是
  // *"That endpoint resolves to an internal/private address and is not allowed."*
  //
  // **判据不是错的，是装错了地方**：`/api/v1/inference/models` 是**公开路由**（访客 BYOAI
  // 面板也在用），它禁私有地址完全正确；而 owner 的后台卡片跟访客共用了这条路由。
  // 产品在**聊天**那一侧早就分对了信任层 —— `eino_model.go` 的 `validateUntrustedEndpoint`
  // 只查 `Untrusted`(BYOAI) 的端点，注释原话「Owner creds (trusted self-host config) are not
  // checked」。发现这一侧没跟上（[[lesson-not-swept-to-neighbours]]）。
  //
  // 替身这边先教会规矩：dev 的 llm-gateway 现在也应 `GET /v1/models`，报两个
  // `mock-selfhost-*` —— 两个而不是一个，否则「列表回来了」和「产品自己塞了个默认」分不开。
  test('owner points at a self-hosted endpoint → the model list comes back (F-R-9)',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.getByTestId('ai-provider-custom').click();
      // dev 栈里的自托管替身。它是 docker 服务名 → 私有地址，跟 owner 家里的 ollama 同一类。
      // 不写 `/v1`：后端自己接 `/v1/models`，写了就成 `/v1/v1/models` → 上游 404。
      // 那种红看起来像「列不出来」，其实是我把地址写长了一截。
      await page.getByTestId('ai-provider-endpoint').fill('http://llm-gateway:9300');
      await page.getByTestId('ai-provider-key').fill('sk-selfhost-does-not-check-keys');
      await page.getByTestId('ai-provider-load-models').click();

      // 判的是**好结果**：列表真的回来了，而且是这台端点报的那两个。
      const picker = page.getByTestId('ai-provider-model-select');
      await expect(picker, 'LOAD MODELS 之后该出现一个下拉').toBeVisible({ timeout: 15_000 });
      await picker.selectOption('mock-selfhost-large');
      await expect(picker).toHaveValue('mock-selfhost-large');
    });

  // F-R-11 —— **key 已经存好之后，LOAD MODELS 就再也点不动了。**
  //
  // 上面那条在**同一次会话里手输了 key**，所以它从没碰到真实的常态：owner 昨天配好，
  // 今天打开这一屏，key 那格写着 `already set · type to replace`（值永不回读，那是对的），
  // 于是 `onLoad` 发出去的 `key: keyText` 是**空串** → 后端 `missingListModelsField` 当场
  // 400 `key required`。owner 面对的是「点了没反应」，而那把 key 明明存着、每一轮访客对话
  // 都在用它。
  //
  // prod 上撞到的（驱 resilience check 3 时）：`POST /api/v1/inference/models → 400`，4ms，
  // 上游一个字节都没收到。
  //
  // 判据要能判负：**先存后重载**，再点。这条用例跟上面那条的差别只有「重载」两个字。
  test('a stored key still lists models — the owner should not have to retype it (F-R-11)',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.getByTestId('ai-provider-custom').click();
      await page.getByTestId('ai-provider-endpoint').fill('http://llm-gateway:9300');
      // model 是保存的必填项（SAVE 在它空着时是灰的）—— 先手输一个，这一条要验的是
      // **保存之后**那次 LOAD MODELS，不是保存本身。
      await page.getByTestId('ai-provider-model').fill('mock-selfhost-large');
      await page.getByTestId('ai-provider-key').fill('sk-selfhost-does-not-check-keys');
      await page.getByTestId('ai-provider-save').click();

      // 重新打开这一屏 —— 现在 key 框是空的，而库里那把还在。这就是 owner 的日常。
      await gotoAdminSection(page, 'dashboard');
      await gotoAdminSection(page, 'api-mcp');
      await expect(
        page.getByText('key set · leave blank to keep'),
        'precondition: the key really is stored and the field really is empty',
      ).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('ai-provider-load-models').click();

      const picker = page.getByTestId('ai-provider-model-select');
      await expect(
        picker,
        'a configured provider must list its models without the owner retyping the key',
      ).toBeVisible({ timeout: 15_000 });
    });
});

