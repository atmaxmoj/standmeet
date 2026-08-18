// admin-load-failure-not-empty.spec.ts —— 加载失败**不许**渲染成一句权威的空话。
//
// 这条守的是一整类，不是一个点。规矩本身早就写在 `use-latest-list.ts` 里：
//   「加载失败别静默成空列表：空 vs『没拉到』owner 得分得清」
// 三处没守它，全都是 `.catch(() => set<空>())`：GET 挂了，组件照样按「取到了，且是空的」渲染。
//
// 为什么这是**真 bug** 而不是洁癖：空态在这几处都是**owner 会当真去信的一句陈述**。
//   - code 卡：「(role grants nothing)」—— 读起来是「这张码什么都读不到」，一个**看起来安全**的谎。
//     owner 据此以为已经锁死了，于是不去收窄。真相是 GET 500 了，role 授的一切照读。
//   - dashboard：「0 sent」/ 空的 recent visitors —— 读起来是「没这回事」，而不是「没拉到」。
// 静默的方向恰好指向「不用管」，所以它不会被 owner 发现 —— 只会被相信。
//
// 发现经过（本 spec 的由来）：prod 上 `GET /codes/{id}/corpus` 每张码都 500（DB 卷比新表老），
// 而 GUI 上**一个错都看不见**，六张卡整整齐齐写着「(role grants nothing)」。控制台里才有 500。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection, reloadAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'loadfail@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'loadfail',
  fullName: 'Load Failure Owner',
};

// LIES —— 每句都是某个 `.catch(() => set<空>())` 会印出来的、owner 会当真的陈述。
const GRANTS_NOTHING = /role grants nothing/i;
// F-N-7 的两句。它们跟上面那句是同一族，只是归因换了层：不是 catch 吞掉了错，
// 而是**渲染这一侧根本没有 error 分支** —— 失败之后列表是空数组，于是直落空态。
const NO_ROLES_YET = /no roles yet/i;
const NOTHING_BANNED = /no ips banned/i;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · a failed load must not render as an authoritative empty', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code corpus: a 500 does not become “(role grants nothing)”', corpusLoadFailure);
  test('code corpus: a 500 surfaces to the owner', corpusLoadFailureIsVisible);
  test('dashboard: a 500 does not become “0 sent”', dashboardCountLoadFailure);
  test('session: a 500 on /me does not become “you are signed out”', meFailureIsNotSignedOut);
  test('session: a 401 on /me still sends the owner to /login', meUnauthedStillRedirects);
  test('a failed load speaks English, not HTTP', failureSpeaksEnglish);
  test('the shell stops calling itself live while the instance is not answering', liveDotTracksReachability);
  test('roles: a 500 does not become “no roles yet”', rolesLoadFailure);
  test('security: a 500 does not become “no IPs banned”', securityLoadFailure);
  test('a genuinely empty list still shows its empty state', emptyStateStillShows);
});

// rolesLoadFailure —— F-N-7。**真实环境驱出来的**：prod 上让只有 `/api/admin/roles` 回 500
// （别的块照常加载），`/admin/roles` 印的是「No roles yet — public is normally seeded on owner
// claim.」，而那台实例有三个角色。
//
// 为什么这一页比别处更要命：它是**权限的总闸**，而空态那句话既是一句关于世界的陈述
// （「这个实例还没有角色」），又指向一个动作（`+ NEW ROLE`）。owner 会在一份没读到的配置上面
// 新建，或者据此以为访客现在什么都读不到。
async function rolesLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  // 正则而不是 glob：真实路径是 `/api/admin/roles/`（带尾斜杠），而 glob 里的 `*` 不跨 `/`。
  // 第一版写成 `**/api/admin/roles*` —— 一发都没拦到，页面照常渲出三张角色卡，
  // 而断言仍然红（红在「没有失败提示」这句上）。**那种红跟真缺陷长得一模一样**
  // （[[read-the-failure-before-theorising]]）：是翻失败截图才看出来的。
  const probe = fail(adminPage, /\/api\/admin\/roles/);
  await reloadAdminSection(adminPage, 'roles');
  await expectInjected(probe, 'roles');
  await expect(
    adminPage.getByTestId('section-load-failed'),
    'the owner must be told the role list failed to load',
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    adminPage.getByText(NO_ROLES_YET),
    'the fetch failed — “no roles yet” is a claim about the world, and this instance has roles',
  ).toHaveCount(0);
}

// securityLoadFailure —— 同一族里方向最危险的一句：「No IPs banned. The public surface is open」。
// 失败时印它，等于在 owner 问「我封了谁」的时候回答「谁也没封，门开着」—— 而真相是没读到。
async function securityLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  const probe = fail(adminPage, /\/api\/admin\/ip-bans/);
  await reloadAdminSection(adminPage, 'ip-bans');
  await expectInjected(probe, 'ip-bans');
  await expect(
    adminPage.getByTestId('section-load-failed'),
    'the owner must be told the ban list failed to load',
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    adminPage.getByText(NOTHING_BANNED),
    'a failed load must not answer “nobody is banned, the surface is open”',
  ).toHaveCount(0);
}

// emptyStateStillShows —— **反方向**。没有这条，一个「干脆永不渲染空态」的实现也能让上面两条转绿，
// 而真正空的实例会盯着一片什么都不说的地方（[[assertion-that-cannot-fail]] 的邻居：
// 只钉一个方向的守卫，会被最省事的错误实现满足）。
//
// 这里不注入故障 —— 拉成功、且真的是空的那一种。这台实例发过码、建过角色，所以要一个
// **本来就空**的列表：`security` 的封禁表在一台干净实例上就是空的。
async function emptyStateStillShows({ adminPage }: { adminPage: Page }): Promise<void> {
  await reloadAdminSection(adminPage, 'ip-bans');
  await expect(
    adminPage.getByText(NOTHING_BANNED),
    'a genuinely empty list must still say so — silence is not an empty state',
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    adminPage.getByTestId('section-load-failed'),
    'nothing failed here — do not cry load failure on a healthy empty list',
  ).toHaveCount(0);
}

// failureSpeaksEnglish —— F-N-5。上面几条守的是「别把失败说成空」，这条守的是**说出来的那句话
// 本身**：prod 上真把 backend 停掉，`/admin/wiki` 印的是
//     GET /corpus/wiki failed: 500
// —— HTTP 动词、内部路径、状态码，三样都甩到 owner 脸上。CLAUDE.md 的规矩逐字写着
// 「Errors must be user-friendly at the UI. No raw stack traces, no exit codes, no technical jargon」。
//
// 归因在**唯一的汇合点**：`lib/api/admin.ts` 的 `throwAPIError` 把 `${method} ${path} failed: ${status}`
// 当成 APIError.message 的兜底，而二十来处 section 直接把 message 印在屏幕上。
// 这条经验产品里已经写过一次 —— `use-obsidian.ts:70` 的注释原话：
// 「a human sentence, never `import failed: 400`. The owner is not debugging」—— 只是没扫到邻居。
//
// 判据断的是**屏幕上的字**：不许出现 HTTP 动词 / `/corpus/` 这种内部路径 / 裸状态码，
// 且必须真有一句话在（不然「什么都不显示」也能过 —— 那是另一个缺陷，不是修好）。
async function failureSpeaksEnglish({ adminPage }: { adminPage: Page }): Promise<void> {
  // 注入的是**没有 envelope 的 500**（真实的进程崩溃 / 反代 502 就是这样），
  // 因为要验的正是「后端一句话都没给出来时，屏幕上出现的是什么」。
  // 上面那个 `fail()` 带着 `{error:{message:'boom'}}`，产品会如实印 'boom' ——
  // 那走的是另一条分支，测不到兜底串。
  await adminPage.route('**/api/admin/corpus/wiki**', (route) => route.fulfill({
    status: 500, contentType: 'text/plain', body: 'upstream connect error',
  }));
  await reloadAdminSection(adminPage, 'wiki');
  const shown = adminPage.getByTestId('wiki-error');
  await expect(shown, 'the owner must be told the list failed to load').toBeVisible({ timeout: 15_000 });
  const text = (await shown.innerText()).trim();
  expect(text.length, 'an empty error line tells the owner nothing').toBeGreaterThan(10);
  expect(text, `owner-facing copy must not be a request line: "${text}"`)
    .not.toMatch(/\b(GET|POST|PUT|PATCH|DELETE)\b|\/corpus\/|\bfailed: \d{3}\b/);
}

// liveDotTracksReachability —— F-N-6。顶栏那颗朱红点旁边写着 `live`，而它读的是**空气**：
// `LiveDot` 里没有任何输入，dev / prod / 后端停机全都长一个样。
// prod 上真停一次 backend 之后点侧栏：正文写着这一节加载失败，顶栏还在 `● LIVE`。
//
// 「哪些还活着」正是状态灯唯一要回答的问题（跟 api·mcp 那张密钥卡上的 `last used` 同一个角色）。
// 判据：注入故障之后那句 `live` 必须**换掉**（说不出话就别说话），而正常时它必须在 ——
// 两个方向都钉住，否则「干脆删掉这颗灯」也能让单向断言转绿。
async function liveDotTracksReachability({ adminPage }: { adminPage: Page }): Promise<void> {
  const liveWord = adminPage.getByTestId('shell-liveness');
  await gotoAdminSection(adminPage, 'wiki');
  await expect(liveWord, 'a healthy instance says live').toHaveText(/live/i, { timeout: 15_000 });

  // 停的是**整台后端**，不是一个端点：一个端点 500 时这台机器仍然在答话，
  // 那时候还说 live 是对的。要复现的是 prod 上真停 backend 的那一幕 ——
  // 会话已经在手里（不重载，靠点侧栏换节），每一个请求都够不着。
  await adminPage.route('**/api/admin/**', (route) => route.fulfill({
    status: 500, contentType: 'text/plain', body: 'upstream connect error',
  }));
  await gotoAdminSection(adminPage, 'raw');
  await expect(
    liveWord, `the instance answers nothing and the shell still calls itself live`,
  ).not.toHaveText(/^live$/i, { timeout: 15_000 });
  // 说清楚它换成了什么 —— 只断"不是 live"的话，渲染成空白也算过。
  const word = (await liveWord.innerText()).trim();
  expect(word.length, 'the dot must say what is wrong, not go blank').toBeGreaterThan(3);
}

// meUnauthedStillRedirects —— 反方向。没有这条，一个「干脆永不跳转」的实现也能让上面那条转绿，
// 而真正过期的会话会卡在一句「够不着服务器」上 —— 同一个缺陷换了个方向而已。
async function meUnauthedStillRedirects({ adminPage }: { adminPage: Page }): Promise<void> {
  await adminPage.route('**/api/admin/me', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'unauthorized', message: 'no session' } }),
  }));
  await reloadAdminSection(adminPage, 'roles');
  await adminPage.waitForURL('**/login', { timeout: 10_000 });
}

// meFailureIsNotSignedOut —— F-N-2。同一类的第四处，衣服换了一件：**「你没登录」也是一句
// 关于世界的断言**，而它同样可能是假的。
//
// `use-admin-session.ts:41/:59` 把 fetch 的 `error` 一律当成 unauthed → `router.push('/login')`。
// 401 和 500 于是收成同一件事，可这两件事给 owner 的指示正好相反：401 要他去登录，
// 500 说服务器不在、登录也没用。合并之后产品给出的恰恰是那个不管用的建议，
// owner 会以为是自己的密码有问题，反复重输。
//
// RED（修复前）：被踢到 /login，页面上一个字都没提服务器。
//
// **必须整页重载**，不能只点侧栏：`gotoAdminSection` 是客户端跳转，`sessionStore` 还留着
// 初次加载时那份 ready，`/me` 压根不会再请求一次 —— 第一版就是这么写的，于是这条用例
// 在没修的代码上也绿，而绿的原因是**故障根本没注入进去**。owner 遇到的那一幕正是重载
// （服务器挂了，他刷新一下、或者新开一个标签页）。
async function meFailureIsNotSignedOut({ adminPage }: { adminPage: Page }): Promise<void> {
  fail(adminPage, '**/api/admin/me');
  await reloadAdminSection(adminPage, 'roles');
  // 等**两种结局里先出现的那一个**（登录表单，或者那句话），再判 —— 这样不必睡固定时长，
  // 而且两条断言都还能红。只等那句话的话，缺陷在时失败信息会是"找不到元素"，
  // 说不出真正发生的事（owner 被踢去登录了）。
  const signInForm = adminPage.getByTestId('email');
  const unreachable = adminPage.getByText(/couldn’t reach|could not reach|not reachable/i).first();
  await expect(signInForm.or(unreachable).first()).toBeVisible({ timeout: 10_000 });
  expect(
    new URL(adminPage.url()).pathname,
    'a 500 is not a sign-out — do not bounce the owner to /login',
  ).not.toBe('/login');
  // 措辞要具体到只有这条分支说得出来 —— 松到 /server/i 会被页面别处的字命中，
  // 那样又是一个不会红的断言。
  await expect(
    unreachable, 'a 500 on /me must say the server could not be reached',
  ).toBeVisible();
}

// fail —— 把某个 admin GET 钉死成 500（真实故障的确定性替身：prod 上它是缺表）。
//
// 返回一个**命中计数**，调用方要断它 > 0。理由这份文件已经付过一次账（见
// `dashboardCountLoadFailure` 那段），而我今天又付了一次：`'**/api/admin/roles*'` 里的 `*`
// 不跨 `/`，真实路径 `/api/admin/roles/` **一发都没拦到**，页面照常渲出三张角色卡 ——
// 可断言仍然红（红在「没有失败提示」上），跟真缺陷长得一模一样。
// 先证「这一发真的被钉成 500 了」，那种假红就不可能再发生。
function fail(page: Page, glob: string | RegExp): { hits: () => number } {
  let hits = 0;
  void page.route(glob, (route) => {
    hits += 1;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'boom' } }),
    });
  });
  return { hits: () => hits };
}

// expectInjected —— 断言那一发真的被拦到了。
async function expectInjected(probe: { hits: () => number }, what: string): Promise<void> {
  await expect.poll(probe.hits, {
    message: `the ${what} GET must actually be intercepted — otherwise this case asserts nothing`,
    timeout: 15_000,
  }).toBeGreaterThan(0);
}

// corpusLoadFailure —— RED（修复前）：catch 把 loaded 设成 true，granted 留空 → 卡片印出
// 「(role grants nothing)」。那句话是错的，且错在**让人放心**的方向。
async function corpusLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  fail(adminPage, '**/api/admin/codes/*/denials');
  await gotoAdminSection(adminPage, 'codes');
  await expect(adminPage.getByTestId('code-list')).toBeVisible({ timeout: 10_000 });
  await expect(
    adminPage.getByText(GRANTS_NOTHING),
    'the fetch failed — claiming the role grants nothing is a lie, and one the owner would trust',
  ).toHaveCount(0);
}

// corpusLoadFailureIsVisible —— 光是「不说谎」不够：owner 得知道这里没拉到，否则控制盘上少了
// 一块而无人察觉。断言的是**好结果**（错误在场），不是「没崩」。
async function corpusLoadFailureIsVisible({ adminPage }: { adminPage: Page }): Promise<void> {
  fail(adminPage, '**/api/admin/codes/*/denials');
  await gotoAdminSection(adminPage, 'codes');
  await expect(adminPage.getByTestId('code-list')).toBeVisible({ timeout: 10_000 });
  await expect(
    adminPage.getByText(/couldn’t load|could not load/i).first(),
    'the owner must be told this control failed to load',
  ).toBeVisible({ timeout: 10_000 });
}

// dashboardCountLoadFailure —— 同一类的第二处。真正的吞在 `dashboard-fetch.ts` 的
// `if (!res.ok) return 0`：500 根本不抛，组件的 catch 收不到，「0 sent」就这么印出去了。
//
// 断言的是**好结果**（'—' = 没拉到），不是「不等于 0」—— 后者在 fetch 回来之前就满足了，会在
// bug 还在的时候瞬间绿掉（本条第一版正是如此）。'—' 只由 error 态产生，loading 是 '…'。
async function dashboardCountLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  let intercepted = 0;
  await adminPage.route(/\/api\/admin\/applications/, (route) => {
    intercepted += 1;
    return route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'boom' } }),
    });
  });
  // 整页重载，而不是"点去别处再点回来"。adminPage 落地时就已经拉过一次 count（那一发早于 route
  // 注册，拿到真值 0），而 Next 的客户端路由会把那个 segment 连同它的 state 一起复用 —— 兜一圈
  // 回来看到的还是那个 0。这条 case 一度是绿的，只因为第一发还没 resolve 就被导航走了；等 codes
  // 页变慢（挂上 picker 之后），它就够时间 resolve 了，于是同一段测试代码开始红。
  // 时序决定成败的断言 = 迟早会骗人的断言。reload 之后什么都不剩，route 必然生效。
  await adminPage.reload();
  // 先证「这一发真的被钉成 500 了」。否则一个没拦到的请求会让断言红在完全无关的地方 ——
  // 本条第一版就是那样：它以为自己在测吞错误，其实测的是"这实例恰好 0 份 application"。
  await expect.poll(() => intercepted, {
    message: 'the applications GET must actually be intercepted — otherwise this asserts nothing',
  }).toBeGreaterThan(0);
  await expect(
    adminPage.getByTestId('dash-applications-sent'),
    'a failed count must read as unknown (—), never as a confident zero',
  ).toHaveText('—', { timeout: 10_000 });
}

// initOwner —— 必须**真发一张码**：没有码就没有 corpus 卡，case 1 会在 bug 还在的时候绿掉
// （找不到「(role grants nothing)」不是因为它没被印出来，是因为整页压根没有卡）。这条 spec 的第一版
// 就是这么假绿的。role 也**故意授了东西** —— 否则「role grants nothing」碰巧是真话，断言又白做。
async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'granted', description: 'grants real corpus', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: 'LOADFAIL-001', label: 'loadfail', assumed_role_id: role.id,
  });
  await request.dispose();
}
