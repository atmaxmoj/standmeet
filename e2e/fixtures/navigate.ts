// navigate.ts —— page navigation helper（spec 共用）。
//
// eslint 规则把 page.goto 限制在 helper/ 里，让 spec 不在测试体里
// teleport。这里集中所有 goto 调用，spec 用语义化函数。
//
// v1 单 owner instance —— 公开页直接挂根 /，URL 不带 handle。

import { expect, type Page } from '@playwright/test';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

// SESSION_OPEN_TIMEOUT_MS —— 等 /sessions 200 的耐心,必须**大于服务端自己给插件拨号的预算**
// (20s,见 `plugin dial ... budget=20s`)。这里曾经写 15s —— 比服务端的预算还短,于是一次
// 合法的冷启(实测 21.8s:三个沙箱首次 spawn+initialize)必然等不到。
//
// 而且后果不只是"这条用例红了":客户端放弃 → 浏览器关掉 → 请求被 abort → 服务端那三次
// 拨号收到 `parent-canceled(caller gave up first)` → 会话**照样开成**,只是每个能力都
// "hidden from this session"。于是失败信息指向会话打不开,真相却是我们自己把它掐了。
const SESSION_OPEN_TIMEOUT_MS = 30_000;

// goto —— 任意相对路径（含 query）。eslint 把 page.goto 限制在 helper/ 里。
// caller 给"/setup?t=xxx"、"/login"、"/alice" 这种。
export async function goto(page: Page, path: string): Promise<void> {
  const url = path.startsWith('/') ? `${APP_BASE}${path}` : `${APP_BASE}/${path}`;
  await page.goto(url);
}

// gotoOnHost —— 同一个实例，换一个**来源**打开（F-D-14）。
//
// 浏览器把 `localhost` / `127.0.0.1` 当 secure context，别的主机名走 http 时不是。而
// 真访客和 owner 必定从别的机器打开这个实例 —— 所以有些行为**只在非 localhost 的来源上**
// 才成立，用默认 baseURL 是驱不出来的。host 由 caller 用 `--host-resolver-rules` 指回本机。
export async function gotoOnHost(page: Page, host: string, path: string): Promise<void> {
  const base = APP_BASE.replace(/\/\/[^:/]+/, `//${host}`);
  await page.goto(`${base}${path.startsWith('/') ? path : `/${path}`}`);
}

// enterCodeSession —— 走 `?code=` 入口拿到一个 code session。
//
// defer-issue 后 /sessions 不在扫码时发,而是在名字选择器**选名字(或 skip)**
// 时才发。所以入口序列固定:goto → 名字选择器出现 → 填名提交(或 skip)→ 等
// /sessions 200。name 给字符串 = 用该名字(具名 member);省略 = skip(匿名)。
export async function enterCodeSession(
  page: Page, code: string, name?: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  // 只等 200,但**把沿途的非 200 记下来**。等待条件只认 200 是对的(会话建成才算进门),
  // 可它会把真实原因过滤掉:后端一路回 401 / 429 时,超时信息只会说"等不到 response",
  // 于是一次明确的拒绝伪装成挂起。2026-08-02 全量里就是这样 —— 后端 4 秒内回了
  // 10×401 + 15×429,而失败信息里一个状态码都看不到。
  const seen: number[] = [];
  const note = (r: { url: () => string; status: () => number }) => {
    if (r.url().endsWith('/api/v1/sessions') && r.status() !== 200) seen.push(r.status());
  };
  page.on('response', note);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200,
    { timeout: SESSION_OPEN_TIMEOUT_MS },
  );
  await submitVisitorName(page, name);
  try {
    await session;
  } catch (e) {
    const detail = seen.length > 0 ? ` — backend answered ${seen.join(',')}` : ' — no response at all';
    throw new Error(`enterCodeSession(${code}): no 200 from /api/v1/sessions${detail}`, { cause: e });
  } finally {
    page.off('response', note);
  }
}

// submitVisitorName —— 名字选择器:有名字就填+提交,没名字就 skip。
async function submitVisitorName(page: Page, name?: string): Promise<void> {
  const skip = page.getByTestId('visitor-name-skip');
  await skip.waitFor({ state: 'visible', timeout: 15_000 });
  if (name === undefined || name === '') {
    await skip.click();
    return;
  }
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
}

// gotoAdminSection —— admin sidebar 上点一个 section 的 nav link。
// 按 testid (data-testid="admin-nav-<slug>") 匹配，不受 design 改 label
// / sidebar 重排 影响。
export async function gotoAdminSection(page: Page, slug: string): Promise<void> {
  await page.getByTestId(`admin-nav-${slug}`).click();
  // 等 URL 真的落地，别只点了链接就走。以前多数测试第一步就找目标页专属的东西（自带等待），所以
  // 这个缺口没露。落地页从 /admin/page 改成 /admin/dashboard 之后，**每个** gotoAdminSection 的
  // 起点都是 dashboard —— 而 dashboard 的 h1（"dashboard · last refresh · now"）是立即可见的
  // level-1 heading，于是任何"点 raw 然后断言 h1"的用例会抓到**旧页**那个抢跑的 h1（UX-12 就这么红）。
  await page.waitForURL(`**/admin/${slug}`, { timeout: 10_000 });
}

// reloadAdminSection —— **整页重载**到 /admin/<slug>，而不是点侧栏。
//
// 两者能观察到的东西不一样：`gotoAdminSection` 是客户端跳转，store 里已经 ready 的缓存
// 不会重来，于是「mount 那一刻的 fetch 失败会怎样」根本触发不到 —— F-N-2 的第一版守卫
// 就是这么在没修的代码上绿掉的，绿的原因是故障从没被注入进去。
// owner 遇到的正是重载这一幕：服务器挂了，他刷新一下，或者第二天新开一个标签页。
export async function reloadAdminSection(page: Page, slug: string): Promise<void> {
  await page.goto(`/admin/${slug}`);
}

// expectAdminSidebarVisible —— 'page' nav 链接可见即视为 sidebar healthy。
export async function expectAdminSidebarVisible(page: Page): Promise<void> {
  await expect(page.getByTestId('admin-nav-page')).toBeVisible();
}
