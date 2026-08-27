// mobile-sweep.spec.ts —— 手机视口下**每一个面各留一张图**，供人眼审阅。
//
// 这套不是功能测试，一条业务断言都没有。它存在是因为响应式坏掉的样子**断言看不见**：
// admin 在 390px 上 `scrollWidth === clientWidth`、没有任何元素超过视口宽度、每一条现成的
// e2e 断言照样绿 —— 而侧栏吃掉 463 的 390，正文只剩 158px，标题裁成 "dashboar"，
// 统计卡片一行一两个字。元素没有溢出，它们是**被压扁的**，而压扁正是那个缺陷
// （[[text-assertion-cannot-see-layout]]）。所以产出是图，判据在看图的人那里。
//
// **名单一律读出来，不手写。** 第一版我对 admin 用了这条规矩（从侧栏的 nav 读，26 个分区
// 一个不落），对公开面却手写了四行 —— 于是整个公开阅读面（/wiki、/writings、文章页）
// 一张都没截，而长文排版正是手机上最吃紧的地方。同一个错误我在自己的注释里写着，
// 隔一屏就犯了（[[lesson-not-swept-to-neighbours]]）。现在两边都读：
//   - 公开路由 ← Next 的 app router 目录（product 加一个页面，这套自动跟上）
//   - admin 分区 ← 产品自己的侧栏
//   - 具体文章 ← 顺着产品自己的索引页点进去（不猜 slug）
//
// 跑：`make mobile-shots`（全部）/ `GREP=owner` 只驱 admin 那组。
// 图落在 e2e/manual-runs/mobile-sweep/，同名覆盖 —— 改完重跑就是同一文件名的前后对照。

import { expect, test } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { createCode } from '@/fixtures/codes';
import { claim, login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const SHOTS = path.join(process.cwd(), 'manual-runs', 'mobile-sweep');
const ROUTES_ROOT = path.join(process.cwd(), '..', 'app', 'src', 'app');

const OWNER = {
  email: 'mobile-sweep@example.com',
  password: 'a-narrow-viewport-is-a-real-viewport-1',
  handle: 'mobileowner',
  fullName: 'Mobile Owner',
};
const CODE = 'MOBILE-01';

// 语料要**够长**：一屏放不下的正文才看得出行宽、断行、表格和溢出。空实例上每个面都好看。
const LONG_BODY = [
  'StandMeet is a foundation for audience-tailored introduction. You curate a corpus of',
  'what you have actually done, and a queryable AI answers each visitor in your own voice,',
  'grounded in your own words, with a citation back to the note it read.',
  '',
  '## Why a corpus and not a résumé',
  '',
  'A résumé is one rendering for every reader. A corpus is the material, and the rendering',
  'happens per conversation — a recruiter, an investor and a collaborator ask different',
  'questions of the same body of work and should not be handed the same page.',
  '',
  'A table is here on purpose: it is the element most likely to force a horizontal scroll',
  'on a narrow screen, and the one a text assertion is least able to see.',
  '',
  '| surface | who it is for | what it holds |',
  '| --- | --- | --- |',
  '| index | anyone holding a code | prose, chat, insights, projects, status |',
  '| gate | a visitor without one | the code box, BYOAI, request access |',
  '| admin | the owner | twenty-six sections over one corpus |',
  '',
  '```go',
  'func longEnoughToOverflow(ctx context.Context, in *AssembleInput) (*Capability, error) {',
  '    return registry.VisitorBinding(ctx, in.SessionID, in.CorpusScope, in.Denials)',
  '}',
  '```',
].join('\n');

// publicRoutes —— 从 app router 的目录读静态公开路由。
// 排除 admin（下面顺侧栏走）、动态段（下面顺索引页点进去）、以及要一次性 token 的
// setup / print / report。
function publicRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, url: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('[') || e.name.startsWith('(')) continue;
      const next = `${url}/${e.name}`;
      if (next.startsWith('/admin')) continue;
      if (['/setup', '/print', '/report'].some((p) => next.startsWith(p))) continue;
      if (fs.existsSync(path.join(dir, e.name, 'page.tsx'))) out.push(next);
      walk(path.join(dir, e.name), next);
    }
  };
  walk(ROUTES_ROOT, '');
  return ['/', ...out.sort()];
}

// settle —— 按下快门之前等**这一屏真的不动了**。
//
// 两个条件，各自对应一种「拍早了」：
//   ① 字体没到位 → 量出来的行宽、断行、有没有溢出全是回退字体下的样子
//      （`navigate.ts` 的 goto 等到 load 是同一个理由：真人在字体到位之后才看页面）。
//   ② 数据还没回来 → 拍到的是加载态。第一版这里只等字体，于是 26 个分区拍出来
//      全是 `loading…` 配一排破折号 —— 而整套用例是绿的，跑得还特别快
//      （3 分钟 → 40 秒）。**变快本身就是那次的证据**。
//
// 等的是**产品自己说的**那句「我还在加载」消失，不是猜一个够大的数。这一屏在加载时
// 会渲骨架（`Skel` 一律带 `.skel` 类）或者字面写着 `loading…`；两样都没有了，才是它落定了。
// `expect` 自带重试，所以这里没有 sleep，也不需要 `networkidle` —— 那两样都是代理指标，
// 而这两个是产品自己发出的信号。
const LOADING_TEXT = /loading…/;

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(LOADING_TEXT)).toHaveCount(0, { timeout: 15_000 });
}

async function shoot(page: Page, name: string, full = false): Promise<void> {
  await settle(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
}

// adminPage fixture 拿哪套凭据登录，读的是 ownerCredentials —— 不覆盖就用默认那套
// （alice@example.com），而这个文件用自己的 email 认领实例，于是登录页停在
// "invalid credentials"，失败报在 fixture 里，看着像 admin 在窄视口下渲不出来。
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// 超时设在 describe 上,不是各个测试体里 —— `test.setTimeout` 在测试体里调,
// **fixture 阶段还没生效**:adminPage 那一步慢了的话,撞的仍是默认的 30s,
// 而红会报在 fixture 里,看着像产品的问题。这里 26 个分区各截两张,本来就慢。
test.describe.configure({ timeout: 600_000 });

test.describe('mobile sweep · 每个面留一张图', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedInstance(await playwright.request.newContext());
  });

  test('公开面 · app router 上有几条静态路由就截几张', async ({ page }) => {
    const routes = publicRoutes();
    let i = 0;
    for (const route of routes) {
      i += 1;
      const name = route === '/' ? 'index' : route.slice(1).replace(/\//g, '-');
      await goto(page, route);
      await shoot(page, `pub-${String(i).padStart(2, '0')}-${name}`);
      // 长滚动的那几页整页也留一张:首屏好看不代表通篇好看。
      await shoot(page, `pub-${String(i).padStart(2, '0')}-${name}-full`, true);
    }
    test.info().annotations.push({
      type: 'routes', description: `${routes.length}: ${routes.join(' ')}`,
    });
  });

  test('公开阅读面 · 顺着索引点进文章', async ({ page }) => {
    // slug 不猜 —— 从索引页第一条点进去,产品自己说文章在哪。
    for (const [idx, name] of [['/wiki', 'wiki'], ['/writings', 'writings']] as const) {
      await goto(page, idx);
      await settle(page);
      // `:visible` 是必须的。桌面版那棵侧栏树在窄屏上被收起来了（这是**对的**响应式），
      // 但链接还在 DOM 里，`.first()` 于是拿到一个点不着的元素，红成
      // "element is not visible" —— 看着像产品在手机上进不去文章，其实是选择器挑错了
      // 那一个（[[harness-confusion-looks-like-a-defect]]）。手机用户走的是下面那张卡片。
      const link = page.locator(`a[href^="${idx}/"]:visible`).first();
      if (await link.count() === 0) {
        test.info().annotations.push({ type: 'empty-index', description: idx });
        continue;
      }
      await link.click();
      await page.waitForURL(new RegExp(`${idx}/.+`));
      await shoot(page, `read-01-${name}-article`);
      await shoot(page, `read-02-${name}-article-full`, true);
    }
  });

  test('访客面 · 身份 → 会话 → 答完一轮', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const tag = await scriptMockReplyText(req, [
      'StandMeet is a stand-in that goes to meet people for you — an AI grounded in the',
      'owner’s own corpus, answering in their voice with a citation back to the note it',
      'read. It replaces the one-size-fits-all résumé with a rendering per conversation,',
      'so a recruiter and a collaborator are not handed the same page.',
    ].join(' '));
    await req.dispose();

    await goto(page, `/?code=${CODE}`);
    await shoot(page, 'visit-01-identity-modal');

    await enterCodeSession(page, CODE);
    await shoot(page, 'visit-02-session-open');

    const input = page.getByTestId('chat-input-field');
    await input.fill(`What is StandMeet?${tag}`);
    await input.press('Enter');
    await page.getByTestId('answer-body').last()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await shoot(page, 'visit-03-answered');
    await shoot(page, 'visit-04-answered-full', true);

    // 引用抽屉是访客唯一能核对答案出处的地方 —— 窄屏上它塌了就等于没有出处。
    const refs = page.getByTestId('answer-citations').first();
    if (await refs.count() > 0) {
      await refs.click();
      await shoot(page, 'visit-05-citations-open');
    }
  });

  test('owner 面 · 侧栏上有几个分区就截几张', async ({ adminPage }) => {
    const slugs = await sweepAdminSections(adminPage);
    test.info().annotations.push({
      type: 'sections', description: `${slugs.length}: ${slugs.join(' ')}`,
    });
  });
});

// seedInstance —— 一台刚认领的实例 + 三种体裁各一篇真内容 + 一个码。
// 内容要**真**且够长:空实例上每个面都好看,而这套图要判的正是内容撑开之后的样子。
async function seedInstance(req: APIRequestContext): Promise<void> {
  resetInstance();
  await claim(req, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(req, OWNER.email, OWNER.password);
  const token = await createAPIToken(req, csrf, 'mobile-sweep');
  const sid = await initMCP(req, token);

  await seedPublicWiki(req, token, sid, {
    body: LONG_BODY, title: 'StandMeet', path: 'projects/standmeet',
  });
  await callTool(req, token, sid, 'writing_create', {
    slug: 'a-corpus-is-not-a-resume',
    title: 'A corpus is not a résumé',
    excerpt: 'One rendering for every reader is the thing being replaced.',
    body_md: LONG_BODY,
    cover_headline: 'corpus.', cover_hue: 'amber',
    tags: ['product', 'corpus'], publish: true,
  });
  await createCode(req, csrf, {
    code: CODE,
    label: 'mobile',
    ghosts: ['What is StandMeet?', 'How do you spend your time?'],
  });
  await req.dispose();
}

// sweepAdminSections —— 侧栏上有几个分区就走几个,各留两张图,返回走过的清单。
async function sweepAdminSections(adminPage: Page): Promise<string[]> {
  await shoot(adminPage, 'admin-00-landing');

  // 窄屏上侧栏是抽屉,得先拉开才点得到分区。这一张本身也要留:抽屉盖着正文时
  // 长什么样,是这次改动新造出来的一个面,没人看过。
  const toggle = adminPage.getByTestId('admin-nav-toggle');
  await toggle.click();
  await shoot(adminPage, 'admin-00b-nav-drawer');

  const slugs = await adminPage.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="admin-nav-"]')]
      .map((e) => e.getAttribute('data-testid')!.replace('admin-nav-', ''))
      .filter((s) => s !== '' && s !== 'toggle'));

  let i = 1;
  for (const slug of slugs) {
    const n = String(i).padStart(2, '0');
    i += 1;
    // 点完抽屉自己收起来(换了分区就该收),所以每一次都要重新拉开。
    const openIfClosed = (await adminPage.getByTestId(`admin-nav-${slug}`).isVisible())
      ? Promise.resolve()
      : toggle.click();
    await openIfClosed;
    await adminPage.getByTestId(`admin-nav-${slug}`).click();
    // 到了这一节,而且它自己的数据拉完了 —— `shoot` 里的 settle 负责后半句。
    await adminPage.waitForURL(new RegExp(`/admin/${slug}$`));
    await shoot(adminPage, `admin-${n}-${slug}`);
    await shoot(adminPage, `admin-${n}-${slug}-full`, true);
  }
  return slugs;
}
