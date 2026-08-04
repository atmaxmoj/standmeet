// testid-family.ts —— 按 testid 前缀数一族元素,并且**说得出数到的是什么**。
//
// 这个文件存在,是因为一次误诊:市场卡片的 testid 是 `market-skill-<id>`,而卡片**里面**
// 的作者字段叫 `market-skill-author` —— 同一个前缀。于是 `[data-testid^="market-skill-"]`
// 把每张卡片数成两个,3 张卡片报 6。
//
// 断言当时只说 `Expected 3, Received 6`。**"整二倍"被读成了"后端结果重复"**,两条用例被
// 标成 test.fixme 停在那儿好几周,账本上还留下一句"fix is backend"。后端从头到尾没事。
//
// 所以这里加的不是一个更严的断言,是一句**说得出所以然的失败**:数不对时把匹配到的 testid
// 一个个列出来;要是其中某个套在另一个里面,单独指认它 —— 嵌套的那一刻就是命名撞了,
// 再往别处猜没有意义。
//
// 数量那一步走 Playwright 自己的 `toHaveCount`,**不是**一次性快照:点完"加载更多"到 DOM
// 落定之间有一段,快照式断言会在那一段里假红。(这条是本文件第一版踩的坑。)

import { expect, type Locator, type Page } from '@playwright/test';

// family —— 一族元素的 locator。跟直接写前缀选择器等价,只是名字说明了意图。
function family(page: Page, prefix: string): Locator {
  return page.locator(`[data-testid^="${prefix}"]`);
}

// expectFamilyCount —— 断言这一族恰好有 n 个;不对就把这一族摊开说。
// 数对了也仍然查一遍嵌套 —— 数字碰巧对上,不代表数的是对的东西。
export async function expectFamilyCount(
  page: Page, prefix: string, n: number,
): Promise<void> {
  try {
    await expect(family(page, prefix)).toHaveCount(n);
  } catch {
    await throwWithFamilyDetail(page, prefix, n);
  }
  await expectFlatFamily(page, prefix);
}

// expectFlatFamily —— 这一族必须是平的:没有哪个成员套在另一个成员里面。
// 套住了就说明前缀被某个**字段**借去用了,那是命名问题,不是数量问题。
async function expectFlatFamily(page: Page, prefix: string): Promise<void> {
  const nested = await nestedMembers(page, prefix);
  expect(nested, nestedMessage(prefix, nested)).toEqual([]);
}

async function throwWithFamilyDetail(
  page: Page, prefix: string, n: number,
): Promise<never> {
  const ids = await familyTestIDs(page, prefix);
  const nested = await nestedMembers(page, prefix);
  const detail = nested.length > 0 ? nestedMessage(prefix, nested) : '';
  expect(ids, `"${prefix}" 这一族匹配到:${ids.join(', ')}。${detail}`).toHaveLength(n);
  throw new Error(`family "${prefix}": count mismatch reported without failing`);
}

function nestedMessage(prefix: string, nested: string[]): string {
  return `testid 前缀 "${prefix}" 被套在同族元素内部的成员借用了:${nested.join(', ')}。` +
    '族前缀是**项**的命名空间,项里面的字段不能再用它开头 —— ' +
    '否则数项时会把字段一起数进去(每项算两个)。';
}

// familyTestIDs —— 这一族当前匹配到的 testid,按 DOM 顺序。
async function familyTestIDs(page: Page, prefix: string): Promise<string[]> {
  return family(page, prefix)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
}

// nestedMembers —— 族里**套在另一个族成员内部**的那些 testid。空 = 这一族是平的。
async function nestedMembers(page: Page, prefix: string): Promise<string[]> {
  return page.locator(`[data-testid^="${prefix}"] [data-testid^="${prefix}"]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
}
