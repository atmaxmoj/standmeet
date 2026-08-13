// shoot.mjs —— 手工验证用的**拍照驱动器**：开一个真浏览器，像人一样登录、点、打字、截图。
//
// 为什么它存在：真实环境审计的第 ⑤ 步（回真环境用眼睛再验一遍）一直靠 Playwright MCP 驱动，
// 那个 MCP 会掉线；掉线时手上只剩一个跑在**另一台机器**上的 Chrome（`isLocal:false`），
// 打不到本机的 38227。驱动器换一个就行 —— 环境仍然是真 prod、真 vault、真语料。
//
// **它不是 e2e**，两处必须分清：
//   - e2e 打 dev 栈并且**每个 spec 都重置实例**。这个脚本打 **prod（38227）**，
//     **绝不重置**：prod 那份语料是真 vault 的镜像，重置掉就没了。
//   - e2e 断言给机器看，这个脚本只产出图给人看。判断看图，不看 DOM 文本。
//
// **写不写？** 大多数 plan 只登录、导航、截图。但 owner 在自己后台点一下开关也是「像人一样点」，
// 有些 check 的前置条件只能这么造（例：backlinks rail 要有一条已发布→已发布的边）。所以允许写，
// 两条边界：① 只走产品自己的界面，不碰数据库、不注 cookie；② 写进去的内容必须来自真 vault，
// 不许为了测试造笔记 —— 发布一条**本来就存在**的笔记不是注入，新建一条是。
// 造了前置条件的 plan，要在对应 trajectory 里写明那一格是我改的。
//
// 用法（走 Makefile，别裸跑）：
//   make verify-shots PLAN=e2e/manual/plans/<name>.json
//
// plan 形状：{ "out": "<trajectory 目录>", "viewport": [w,h], "shots": [{ "name": "...",
//   "url": "/admin/seo", "wait": 1200, "steps": [{ "click": "text=..." } | { "type": ["sel","txt"] }
//   | { "wait": 800 }] }] }
// `steps` 只有点击和输入两种 —— 人做得出来的那两种；`wait` 是给懒加载留的时间，不是动作。

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
    // 懒加载的树：上一次点击要等它把下一层取回来，下一个选择器才存在。
    step.wait && await page.waitForTimeout(step.wait);
  }
  await page.waitForTimeout(shot.wait ?? 1200);
  const file = `${plan.out}/${shot.name}.png`;
  // fullPage —— 一页装不下的东西(reader 的 backlinks rail 在正文之后)要整页拍。
  // 之前靠「点一下 body」假装滚动,拍出来跟没滚一样,两张图完全相同 —— 那不是证据。
  await page.screenshot({ path: file, fullPage: shot.fullPage === true });
  console.log(`shot ${file}`);
}

await browser.close();
