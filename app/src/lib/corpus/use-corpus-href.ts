// use-corpus-href —— 读者正在读的那个语言，跟着链接走。
//
// `?lang=zh` 换的是**这一条**笔记的那一面，而读者不是只读一条:选完语言接着点树上另一条,
// 那条链接是光秃秃的 `/wiki/<path>`，语言当场没了，一点回英文。**只能选一次的选择等于
// 没有这个选择**（owner 原话:「那我要他有什么用」）。
//
// 为什么修在这里:语料地址只有一个家（`corpusHref`，见 href.ts 开头那段账）。语言是地址的
// 一部分，那它就属于同一个家 —— 否则就是 34 个调用点各自记得加一次 `?lang=`，
// 也就是同一把散弹枪再打一遍。
//
// 为什么仍然走 URL 而不是存起来:地址带着语言，链接分享出去对方看到同一面，爬虫抓到的
// 就是那一面，后退键回到上一种语言。这三条是 LanguageSwitch 当初选 URL 的理由，一条都没变。
// 这里补的只是「往前走的时候也带着」。

'use client';

import { useSearchParams } from 'next/navigation';

import { citationHref, corpusHref, type CorpusGenre, type CorpusRef } from '@/lib/corpus/href';

// useCorpusHref —— 返回一个算地址的函数，它把读者当前的语言接在后面。
//
// 没选语言（地址上没有 `?lang=`）时它跟 `corpusHref` 逐字相同 —— 不会凭空造出一个
// `?lang=`，因为「没选」和「选了默认那个」不是一回事:后者会把笔记自己的身份语言顶掉。
export function useCorpusHref(): (ref: CorpusRef) => string {
  const lang = useSearchParams()?.get('lang') ?? '';
  return (ref: CorpusRef) => withLang(corpusHref(ref), lang);
}

// useCitationHref —— 答案下面那条引用，同样带着语言。挑 path 还是 slug 仍归 citationHref
// （那是体裁的事），这里只接上语言。
export function useCitationHref():
(c: { genre: CorpusGenre; path: string; slug: string }) => string {
  const lang = useSearchParams()?.get('lang') ?? '';
  return (c) => withLang(citationHref(c), lang);
}

// useReaderLangHref —— 给一条**已经算好的**地址接上语言。
//
// 正文里的链接不经 corpusHref:vault 的 `[[X]]` 由后端改写成 `/wiki/<path>` 再交给
// markdown 渲染。而那恰恰是读者读着读着点得最多的一种链接 —— 面包屑带上了语言、
// 正文里的没带,选择照样在第一次点击时丢掉(线上量到的就是这个:面包屑三条带 ?lang=zh,
// 正文里三条光秃秃)。
//
// 只认本站的语料路径:外链和别的路由原样不动 —— 给第三方的地址挂一个我们的查询参数
// 既没用又冒犯。
export function useReaderLangHref(): (href: string) => string {
  const lang = useSearchParams()?.get('lang') ?? '';
  return (href: string) => (isCorpusPath(href) ? withLang(href, lang) : href);
}

const CORPUS_PATH = /^\/(wiki|output|writings)\//;

// isCorpusPath —— 本站的语料地址,而且**还没带查询串**。带了的自己已经说清要什么,
// 不覆盖(比如切换器自己那几条 `?lang=en`)。
function isCorpusPath(href: string): boolean {
  return CORPUS_PATH.test(href) && !href.includes('?');
}

// withLang —— 空地址原样返回（调用方据此不渲染链接，见 corpusHref）。
function withLang(href: string, lang: string): string {
  return href === '' || lang === '' ? href : `${href}?lang=${encodeURIComponent(lang)}`;
}
