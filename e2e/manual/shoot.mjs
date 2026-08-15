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

// acceptDialogs —— 原生 confirm()/alert() 一律点「确定」。**必须逐个 plan 显式打开**：
// 人点 OK 是真实动作，但默认接受会让别的 plan 里的破坏性确认被静默点掉，而那种事发生时
// 截图上什么都看不出来。要它的 plan 自己写 `"acceptDialogs": true`。
if (plan.acceptDialogs === true) {
  page.on('dialog', (d) => { void d.accept(); });
}

// downloadDir —— 把页面触发的下载存到磁盘。人点「下载」拿到的就是文件本身;**不是**去截图上
// 把内容抄下来。抄一段 base64 私钥错一个字符,失败会长得像产品的问题,而不是像我的手误。
if (typeof plan.downloadDir === 'string') {
  await mkdir(plan.downloadDir, { recursive: true });
  page.on('download', (d) => {
    void d.saveAs(`${plan.downloadDir}/${d.suggestedFilename()}`)
      .then(() => console.log(`download ${d.suggestedFilename()}`));
  });
}

// 浏览器侧的日志一律转出来。没有这一勺时，一次登录不动只给得出一句 waitForURL 超时，
// 而超时对「表单没提交」「请求发了但 4xx」「JS 挂了」三种情况说的是同一句话 ——
// 于是只能靠推理，而推理三次都错过。
// 全部转出来，不只 error/warning。产品自己写的回执（`[turnstile] rendered widget id=…`）
// 是 `console.log`，而只转 error 的那一版把它滤掉了 —— 于是「校验框渲没渲出来」这件事
// 页面上看不见、控制台也听不见，只剩下推理。
page.on('console', (m) => console.log(`console.${m.type()} ${m.text()}`));
page.on('pageerror', (e) => console.log(`pageerror ${e.message}`));
page.on('requestfailed', (r) => console.log(`requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`http ${r.status()} ${r.request().method()} ${r.url()}`);
});

// 登录走**真表单**：填邮箱、填密码、按回车 —— 不注 cookie、不塞 token。
if (plan.login !== false) {
  // 空凭据当场停。`?? ''` 会把它们原样填进表单，产品回一句「email + password required」，
  // 而驱动器只报得出 waitForURL 超时 —— 「忘了加载凭据」于是长得跟「产品登录坏了」一模一样。
  if (EMAIL === '' || PASSWORD === '') {
    console.error('no owner credentials in env — run it through `make verify-shots PLAN=…`, '
      + 'which sources ~/.config/standmeet/verify-creds.env');
    process.exit(2);
  }
  await page.goto(`${BASE}/login`);
  await page.getByTestId('email').fill(EMAIL);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('password').press('Enter');
  // `**/admin**` 而不是 `**/admin/**`：LoginForm 成功后 push 的是 `/admin` 本身
  // （`LoginForm.tsx:164`），后面没有下一段，带斜杠的 glob 匹配不到，登录明明成功
  // 也会在这里超时 —— 而报出来的样子像是「登录失败」。
  await page.waitForURL('**/admin**', { timeout: 15_000 }).catch(async (err) => {
    // 超时了就把现场说清楚：停在哪个 URL、表单自己报了什么错、提交键是不是被禁用。
    const err_text = await page.getByTestId('error').textContent().catch(() => null);
    const disabled = await page.getByTestId('submit').isDisabled().catch(() => null);
    console.log(`login stuck at ${page.url()} · form error=${err_text} · submit disabled=${disabled}`);
    throw err;
  });
}

for (const shot of plan.shots) {
  await page.goto(`${BASE}${shot.url}`);
  for (const step of shot.steps ?? []) {
    step.click && await page.locator(step.click).first().click();
    step.type && await page.locator(step.type[0]).first().fill(step.type[1]);
    // typeFile —— 从文件粘贴。长正文（一篇笔记）手抄进 plan 的 JSON 里要转义换行、引号、
    // 方括号，抄错一个字符会长得像产品把内容弄坏了，而不是像我的手误（跟 downloadDir 同一条理由）。
    // 人从文件里复制粘贴是真动作。
    step.typeFile && await page.locator(step.typeFile[0]).first()
      .fill(await readFile(step.typeFile[1], 'utf8'));
    // typeOwner —— 把 owner 自己的邮箱/密码填进某个输入框（值来自 verify-creds.env）。
    // plan 是提交进仓库的 JSON，密码不能写在里面；而有些 check 要的正是「**正确**的密码
    // 加上一次失败的人机校验，产品会说哪句话」—— 用一个错密码去驱，两种原因指向同一句话，
    // 那一格就什么也证明不了。`login: false` 的 plan 自己走登录表单时用它。
    step.typeOwner && await page.locator(step.typeOwner[0]).first()
      .fill(step.typeOwner[1] === 'password' ? PASSWORD : EMAIL);
    // pickDir —— 往 `<input type="file" webkitdirectory>` 里选一个**目录**（vault 导入用的
    // 就是这种控件）。人点「import from Obsidian」后在系统对话框里选的也正是一个目录。
    step.pickDir && await page.locator(step.pickDir[0]).setInputFiles(step.pickDir[1]);
    // select —— 下拉选一项。人点开下拉挑一个；`type` 那条（fill）对 `<select>` 不起作用。
    step.select && await page.locator(step.select[0]).first().selectOption(step.select[1]);
    // press —— 有些东西只能按键提交（访客对话框没有发送按钮，回车就是发送）。
    step.press && await page.locator(step.press[0]).first().press(step.press[1]);
    // hover —— 把鼠标停在某个东西上。图表的读数只在指针底下才出现，而截图拍不到
    // "刚才鼠标路过"这件事 —— 要拍到 tooltip，就得先真的把指针放上去、并且**停在那儿**。
    // 用法：{"hover": "[data-testid=\"sparkline-box\"]"} 或 {"hover": ["sel", 0.9]}（0.9 = 横向位置比例）
    step.hover && await (async () => {
      const sel = Array.isArray(step.hover) ? step.hover[0] : step.hover;
      const frac = Array.isArray(step.hover) ? step.hover[1] : 0.5;
      const box = await page.locator(sel).first().boundingBox();
      box && await page.mouse.move(box.x + box.width * frac, box.y + box.height / 2);
      await page.waitForTimeout(300);
    })();
    // scroll —— 把鼠标移到某个容器上滚轮。admin 的滚动在**内层容器**里（侧栏自己一个
    // overflow-y-auto，正文另一个），所以「滚页面」滚不动它们，而 fullPage 也拍不到 ——
    // 判断「下面那截够不够得着」只能真的滚一次。用法：{"scroll": ["nav", 600]}
    step.scroll && await (async () => {
      await page.locator(step.scroll[0]).first().hover();
      await page.mouse.wheel(0, step.scroll[1]);
      await page.waitForTimeout(400);
    })();
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
