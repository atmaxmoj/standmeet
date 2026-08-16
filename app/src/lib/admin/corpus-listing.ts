// corpus-listing —— 「此刻网格底下装的是哪一份集合、它从哪儿翻页」。
//
// 这是**推导**，不是渲染，所以它在这一层而不在组件里（表现层不许写分支）。
// 两份集合长得一模一样而完备性相反：
//   - 标签筛 → 这一页的子集，翻页由 `gridSource` 向服务端要下一页（带着标签）；
//   - 搜索   → 全库命中，**不给 gridSource** —— 那是标签分页的来源，给了的话滚到底
//     会把标签页的下一页续在命中后面，屏幕上再也分不出哪些是搜到的。
// 搜索优先：输入框里有词时不跟标签叠加。「在这一页里按标签筛」和「在全库里按内容找」
// 是两种意图，叠起来会得到一个既不全也不准的集合。

import type { z } from 'zod';

import type { CorpusSearchHook } from '@/lib/admin/use-corpus-search';
import type { CorpusView } from '@/lib/admin/corpus-view';

// schema 跟着行的类型走：网格拿它解析**下一页的行**，两者必须是同一个类型，
// 否则「翻回来的东西」和「屏幕上已有的东西」可以是两种形状而没人报错。
export interface CorpusGridSource<Row> {
  pagePath: string;
  schema: z.ZodType<Row>;
}

export interface CorpusListing<Row> {
  rows: readonly Row[];
  view: CorpusView;
  /** 展开进 `<CorpusTreeGrid {...}>`：搜索中它是空对象，网格于是只显示命中集。 */
  gridProps: { gridSource?: CorpusGridSource<Row> };
}

/**
 * filterByTag —— 只给**树**视图用：树是懒加载的层级，一次一层，标签在这里是「把这一层筛一下」。
 * 网格视图**不**走这里 —— 它是分页视图，筛选必须下推到取页那一步（`taggedPagePath`），
 * 否则筛的就只是已加载的那一页，而面板会把结果当成整个语料的答案
 * （F-L-23：137 条 math 显示成 1 条）。
 */
export function filterByTag<Row extends { tags: readonly string[] }>(
  rows: readonly Row[], tag: string | null,
): readonly Row[] {
  return tag === null ? rows : rows.filter((r) => r.tags.includes(tag));
}

/**
 * taggedPagePath —— 把选中的标签带进分页地址。分页源不再因为「选了标签」就被关掉：
 * 关掉它正是 F-L-23 的成因。
 */
export function taggedPagePath(base: string, tag: string | null): string {
  return tag === null ? base : `${base}?tag=${encodeURIComponent(tag)}`;
}

export function corpusListing<Row>(input: {
  search: CorpusSearchHook;
  searchRows: readonly Row[];
  tagRows: readonly Row[];
  view: CorpusView;
  gridSource: CorpusGridSource<Row>;
}): CorpusListing<Row> {
  return input.search.active
    ? { rows: input.searchRows, view: 'grid', gridProps: {} }
    : { rows: input.tagRows, view: input.view, gridProps: { gridSource: input.gridSource } };
}
