// href.ts —— **一条语料在公开站上的地址，只有这里算得出来。**
//
// 为什么要有这个模块：这件事以前没有主人，15 个地方各自现拼一遍，而它们**互相不一致**：
//   - `/writings/${writing.slug}`  ← WritingCards ×3 / WritingsIndex / WritingArticle
//   - `/writings/${node.path}`     ← WritingTreeAside / writings/[slug]/page.tsx
//   - `/wiki/${node.path}`         ← 7 处
//   - `/${c.genre}/${c.path}`      ← 两处引用链接
//
// 最后那一种在 prod 上渲出了一个 404：`sijie.xyz/writing/writings/the-business-model-wedge`。
// 它把**体裁名当成了路由名** —— 体裁是单数 `writing`，路由是复数 `/writings/[slug]`；
// 而那条 writing 的语料 path 本身又带 `writings/` 前缀（vault 里就有这个目录），于是叠成两段。
//
// 更深的那一层在 `public.ts` 的 `mapWritingNode`：它把 `slug` 装进了 `path` 字段
// （注释里还写着"slug 装进 path"）。于是同一个 `TreeNode.path`，树接口给的是 slug、
// 引用结果给的是真实路径 —— **同一个字段名两种含义**，而这正是同一个表达式在一块屏上对、
// 在另一块屏上 404 的原因（[[names-that-lie]]）。改名让各处的独立决定"看起来"一致，
// 而它们从来就不一致。
//
// 所以这里收的不是一个字符串拼接，是两个决定：
//   ① 每种体裁对应哪个路由段（writing → writings 这条单复数在别处已经被就地解决过第三遍了，
//      见 `use-corpus-scope-tree.ts` 的 `genre === 'writing' ? …`）
//   ② 每种体裁用**哪个标识**寻址：writings 用 slug，wiki / output 用树路径
//
// 闸门 `check-one-corpus-href` 只允许这三个前缀从本文件出来。

// CorpusGenre —— 公开站上**可寻址**的三种体裁。raw / subjectivity 没有公开页面，
// 所以它们不在这里 —— 这个联合类型本身就是「什么东西有地址」那份名单。
export type CorpusGenre = 'wiki' | 'output' | 'writing';

// ROUTE_SEGMENT —— 体裁 → 路由段。**只有 writing 是不一样的**，而正是这一条让
// `/${genre}/…` 这种写法在两种体裁上侥幸成立、在第三种上 404。
const ROUTE_SEGMENT: Readonly<Record<CorpusGenre, string>> = {
  wiki: 'wiki',
  output: 'output',
  writing: 'writings',
};

// CorpusRef —— 一条语料的**地址凭据**。
//
// 两个标识分开写，不合并成一个 `path`：wiki / output 按树路径寻址（多段，`/wiki/a/b/c`），
// writings 按 slug 寻址（单段）。合并的那一刻就得有人在某个边界上做改名，而那次改名
// 就是这个缺陷的来历。调用方给不出对应体裁要的那个标识时，这里返回空串而不是猜一个 ——
// 一个指不到的链接比没有链接更糟：它看起来可点，点下去是 404。
export type CorpusRef =
  | { genre: 'wiki' | 'output'; path: string }
  | { genre: 'writing'; slug: string };

// corpusHref —— 这条语料在公开站上的地址。标识为空 → 空串（调用方据此不渲染链接）。
export function corpusHref(ref: CorpusRef): string {
  const id = ref.genre === 'writing' ? ref.slug : ref.path;
  return id === '' ? '' : `/${ROUTE_SEGMENT[ref.genre]}/${stripLeadingSlash(id)}`;
}

function stripLeadingSlash(s: string): string {
  return s.startsWith('/') ? s.slice(1) : s;
}

// citationHref —— 答案下面那条引用的地址。
//
// 引用行手里同时有 path（给人看的位置）和 slug（writings 的地址），**挑哪一个是这里的事**，
// 不是渲染那一侧的事 —— 以前它是渲染那侧的一句 `/${genre}/${path}`，抄了两份，两份都错。
export function citationHref(c: { genre: CorpusGenre; path: string; slug: string }): string {
  return c.genre === 'writing'
    ? corpusHref({ genre: 'writing', slug: c.slug })
    : corpusHref({ genre: c.genre, path: c.path });
}
