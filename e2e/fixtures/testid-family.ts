// testid-family.ts —— count a family of elements by testid prefix, and **be able to say what was counted**.
//
// This file exists because of a misdiagnosis: a marketplace card's testid is `market-skill-<id>`, while the
// author field **inside** the card is called `market-skill-author` —— the same prefix. So `[data-testid^="market-skill-"]`
// counted each card as two, reporting 6 for 3 cards.
//
// The assertion at the time only said `Expected 3, Received 6`. **The "exact double" was read as "duplicated
// backend results"**, two cases were marked test.fixme and sat there for weeks, and the ledger even carried a line
// "fix is backend". The backend was fine the whole time.
//
// So what's added here isn't a stricter assertion, it's a **failure that explains itself**: when the count is off,
// list the matched testids one by one; and if one is nested inside another, call it out specifically —— that nesting
// is the moment a name collided, and guessing elsewhere is pointless.
//
// The counting step uses Playwright's own `toHaveCount`, **not** a one-shot snapshot: between clicking "load more"
// and the DOM settling there's a gap, and a snapshot-style assertion goes falsely red in that gap. (This one was hit by the file's first version.)

import { expect, type Locator, type Page } from '@playwright/test';

// family —— a locator for a family of elements. Equivalent to writing the prefix selector directly, just named to convey intent.
function family(page: Page, prefix: string): Locator {
  return page.locator(`[data-testid^="${prefix}"]`);
}

// expectFamilyCount —— assert this family has exactly n members; if not, spell the family out.
// Even when the count matches, still check for nesting once —— a count that happens to line up doesn't mean the right thing was counted.
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

// expectFlatFamily —— this family must be flat: no member nested inside another member.
// Nesting means the prefix was borrowed by some **field**, which is a naming problem, not a count problem.
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

// familyTestIDs —— the testids this family currently matches, in DOM order.
async function familyTestIDs(page: Page, prefix: string): Promise<string[]> {
  return family(page, prefix)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
}

// nestedMembers —— the testids in the family that are **nested inside another family member**. Empty = this family is flat.
async function nestedMembers(page: Page, prefix: string): Promise<string[]> {
  return page.locator(`[data-testid^="${prefix}"] [data-testid^="${prefix}"]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
}
