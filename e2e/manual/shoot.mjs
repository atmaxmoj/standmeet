// shoot.mjs —— 手工验证用的**拍照驱动器**：开一个真浏览器，像人一样登录、点、打字、截图。
//
// 为什么它存在：真实环境审计的第 ⑤ 步（回真环境用眼睛再验一遍）一直靠 Playwright MCP 驱动，
// 那个 MCP 会掉线；掉线时手上只剩一个跑在**另一台机器**上的 Chrome（`isLocal:false`），
// 打不到本机的 38227。驱动器换一个就行 —— 环境仍然是真 prod、真 vault、真语料。
//
// **它不是 e2e**，两处必须分清：
//   - e2e 打 dev 栈并且**每个 spec 都重置实例**。这个脚本打 **prod（38227）**，
//     **一行都不写**：只登录、导航、截图。prod 那份语料是真 vault 的镜像，重置掉就没了。
//   - e2e 断言给机器看，这个脚本只产出图给人看。判断看图，不看 DOM 文本。
//
// 用法（走 Makefile，别裸跑）：
//   make verify-shots PLAN=e2e/manual/plans/<name>.json
//
// plan 形状：{ "out": "<trajectory 目录>", "viewport": [w,h], "shots": [{ "name": "...",
//   "url": "/admin/seo", "wait": 1200, "steps": [{ "click": "text=..." } | { "type": ["sel","txt"] }] }] }
// `steps` 只有点击和输入两种 —— 人做得出来的那两种。

import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:38227';
const EMAIL = process.env.STANDMEET_OWNER_EMAIL ?? '';
const PASSWORD = process.env.STANDMEET_OWNER_PASSWORD ?? '';

const planPath = process.argv[2];
if (!planPath) {
  console.error('usage: node e2e/manual/shoot.mjs <plan.json>');
  process.exit(2);
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const [vw, vh] = plan.viewport ?? [1280, 900];
await mkdir(plan.out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
const page = await ctx.newPage();

// 登录走**真表单**：填邮箱、填密码、按回车 —— 不注 cookie、不塞 token。
if (plan.login !== false) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('email').fill(EMAIL);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('password').press('Enter');
  await page.waitForURL('**/admin/**', { timeout: 15_000 });
}

for (const shot of plan.shots) {
  await page.goto(`${BASE}${shot.url}`);
  for (const step of shot.steps ?? []) {
    step.click && await page.locator(step.click).first().click();
    step.type && await page.locator(step.type[0]).first().fill(step.type[1]);
  }
  await page.waitForTimeout(shot.wait ?? 1200);
  const file = `${plan.out}/${shot.name}.png`;
  await page.screenshot({ path: file });
  console.log(`shot ${file}`);
}

await browser.close();
