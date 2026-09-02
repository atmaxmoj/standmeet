// visitor-ghost-readable.spec.ts —— F-A-25: a ghost must be **readable to the end**.
//
// The ghost has always been rendered as a textarea's `placeholder` attribute. A placeholder
// doesn't wrap: it's one line, clipped at the element's width, no ellipsis. But the ghost is
// model-generated prose of arbitrary length, so every ghost longer than a short phrase cuts
// off mid-sentence — the visitor never sees the second half, and so never learns where it
// was steering them.
//
// This isn't a case of the container being too small: the same string, pulled into the same
// box as the **value** via Tab, makes the textarea grow, wrap, and read completely. What
// doesn't fit is the delivery mechanism, not the box.
//
// The criterion has to be **geometric**, not text-based — the `data-ghost` attribute and
// innerText look identical whether or not the text got clipped, which is exactly how the
// existing visitor-chat-ghost.spec.ts stays green. So this asserts three things:
//   1. the ghost has a real rendered element (not just an attribute);
//   2. it has no horizontal overflow (scrollWidth <= clientWidth) — a nowrap single line
//      would go red here;
//   3. it occupies at least two lines of height — proof it actually wrapped, rather than
//      being hidden by overflow:hidden.
//
// RED (before the fix): the ghost only existed inside the placeholder attribute, and the
// element didn't exist → the first assertion alone goes red.

import { test, expect } from '@/fixtures/test';
import type { Locator, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'ghost-readable@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghostread',
  fullName: 'Ghost Readable Owner',
};
const CODE = 'GHOSTREAD-001';

// A ghost of realistic length — the ones observed on prod are around this scale
// ("You mentioned your frameworks. I noticed you have a note called 'recursive-harness' — is
// that another one? I'd like to read it."). A short string might happen to fit in a narrow
// box too, and that kind of green wouldn't prove anything.
const LONG_GHOST =
  'You mentioned your frameworks. I noticed you have a note called '
  + "'recursive-harness' — is that another one? I'd like to read it.";

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor ghost · 读得完 · F-A-25', () => {
  test('长 ghost 渲成一个会换行的元素,不横向溢出', async ({ page }) => {
    await enterCodeSession(page, CODE, 'Reader');
    const ghost = page.getByTestId('chat-ghost-text');
    await expect(ghost, 'ghost 要有一个真的渲染元素,不能只活在一个属性里')
      .toBeVisible({ timeout: 10_000 });
    await expect(ghost, 'ghost 元素带的就是那条完整的 ghost').toHaveText(LONG_GHOST);

    const box = await overflow(ghost);
    expect(
      box.scrollWidth,
      `ghost 不得横向溢出(裁字):scrollWidth=${box.scrollWidth} clientWidth=${box.clientWidth}`,
    ).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(
      box.height,
      `这条 ghost 一行放不下,必须换行:height=${box.height} lineHeight=${box.lineHeight}`,
    ).toBeGreaterThan(box.lineHeight * 1.5);
  });

  // While a ghost is present, the input's own placeholder must yield and go empty. The first
  // fix didn't do this, so "ask…" sat piled on top of the ghost's first line — the geometric
  // assertion above stayed all green because it only measures the ghost element, and can't
  // detect another string layered underneath it. This one was caught by eye on prod, and is
  // added back as a gate.
  test('ghost 在场时,输入框自己的 placeholder 让位(不叠字)', async ({ page }) => {
    await enterCodeSession(page, CODE, 'NoOverlap');
    await expect(page.getByTestId('chat-ghost-text')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId('chat-input-field'),
      'ghost 覆盖层和 placeholder 不能同时画在同一格上',
    ).toHaveAttribute('placeholder', '');
  });

  test('Tab 仍然把完整的一条收进输入框', async ({ page }) => {
    await enterCodeSession(page, CODE, 'Tabber');
    const input = page.getByTestId('chat-input-field');
    await expect(page.getByTestId('chat-ghost-text')).toBeVisible({ timeout: 10_000 });
    await input.focus();
    await input.press('Tab');
    await expect(input, 'Tab 接受的是完整的一条,不是被裁的那半句').toHaveValue(LONG_GHOST);
  });

  test('访客一开始打字,ghost 就让位', async ({ page }) => {
    await enterCodeSession(page, CODE, 'Typer');
    const input = page.getByTestId('chat-input-field');
    await expect(page.getByTestId('chat-ghost-text')).toBeVisible({ timeout: 10_000 });
    await input.fill('my own question');
    await expect(
      page.getByTestId('chat-ghost-text'),
      '输入框里有字之后 ghost 不该还压在上面',
    ).toHaveCount(0);
  });
});

interface GhostBox {
  clientWidth: number;
  scrollWidth: number;
  height: number;
  lineHeight: number;
}

// overflow —— measures this element's horizontal overflow + actual height + line height. A
// text assertion can't distinguish "rendered" from "clipped," so the criterion has to be geometric.
async function overflow(el: Locator): Promise<GhostBox> {
  return await el.evaluate((n: HTMLElement) => ({
    clientWidth: n.clientWidth,
    scrollWidth: n.scrollWidth,
    height: n.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(n).lineHeight),
  }));
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'ghostread-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: 'Alpha', body: 'Alpha shipped last quarter.', path: 'alpha',
  });
  const role = await createRole(request, csrf, {
    name: 'ghost-read-role', description: 'ghost readability spec',
    corpus_uris: ['wiki://**'],
    waypoints: [{
      waypoint_id: 'grasp-alpha', description: 'understand Alpha',
      weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
    }],
  });
  // The initial ghost comes from code.ghosts' first entry — visible in the input without
  // waiting for a round-trip model answer.
  await createCode(request, csrf, {
    code: CODE, label: 'ghostread', assumed_role_id: role.id, ghosts: [LONG_GHOST],
  });
  await request.dispose();
}
