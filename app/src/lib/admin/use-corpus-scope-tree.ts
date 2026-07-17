// use-corpus-scope-tree —— corpus 准入 picker 的数据面：**一个 URI 一棵真树**。
//
// 为什么存在（F-A-14）：role 的授权和 code 的收回过去都是一个裸 textarea，owner 得默写 scheme 和
// 一条笔记确切的**服务端 slug**（`subjectivity://cv`）。没有发现性、没有补全、没有校验，而且打错是
// **静默**的 —— 收回那侧静默少读，授权那侧静默少授。corpus 本来就是一棵树，就该从树上勾。
//
// 关键的对齐：URI **必须**是后端 `domain.FormatURI(genre, path)` 那一份，而 path 是服务端 slug 过
// 的（`slugJoin`，SlugifyTitle 是唯一源）。所以 picker 只用树行里带的 `path`，绝不拿 title 自己拼
// —— 自己拼就是第二份 slug 实现，必然与匹配器漂移。

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// ScopeNode —— picker 只需要这四个字段；四个 genre 的树都能塌成这个形状。
export const ScopeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  // path —— 服务端 slug 过的地址（root→leaf）。URI = `${genre}://${path}`。
  path: z.string().nullable().optional(),
  has_children: z.boolean().optional(),
});
export type ScopeNode = z.infer<typeof ScopeNodeSchema>;

// SCOPE_GENRES —— ACL 认得的 genre。raw 不在：`raw://**` 对 visitor 是硬编码 deny
// （MatchesAnyCorpusGlob 第一行），给它一个勾只会骗人。
export const SCOPE_GENRES = ['wiki', 'output', 'writing', 'subjectivity'] as const;
export type ScopeGenre = typeof SCOPE_GENRES[number];

// treePath —— writing 的树自成一条路由（它不在 /corpus/{genre} 的分派里）；其余走统一那条。
function treePath(genre: ScopeGenre, parentID: string): string {
  const qs = parentID === '' ? '' : `?parent=${encodeURIComponent(parentID)}`;
  return genre === 'writing' ? `/writings/tree${qs}` : `/corpus/${genre}/tree${qs}`;
}

export function loadScopeLayer(genre: ScopeGenre, parentID: string): Promise<ScopeNode[]> {
  return adminAPI.get(treePath(genre, parentID), z.array(ScopeNodeSchema));
}

// uriOf —— 这一行代表的 URI。与 domain.FormatURI 逐字一致。
export function uriOf(genre: ScopeGenre, node: ScopeNode): string {
  return `${genre}://${node.path ?? ''}`;
}

// subtreeGlobOf —— 「这条**以及它底下的一切**」。glob 方言里 `g://p/**` 编译成 `^g://p/.*$`，
// **不**匹配 `g://p` 本身 —— 所以「一条 + 它的子树」天生是两条 glob，不是一条。勾一个有子节点的
// 节点时两条都要发，否则 owner 以为授了整棵、实际漏了那个 folder-note 自己。
export function subtreeGlobOf(genre: ScopeGenre, node: ScopeNode): string {
  return `${genre}://${node.path ?? ''}/**`;
}

export function genreGlob(genre: ScopeGenre): string {
  return `${genre}://**`;
}

// globsFor —— 勾一行 = 它自己 +（有子节点时）它的整棵子树。
export function globsFor(genre: ScopeGenre, node: ScopeNode): string[] {
  return node.has_children === true
    ? [uriOf(genre, node), subtreeGlobOf(genre, node)]
    : [uriOf(genre, node)];
}

// isTreeExpressible —— 这条 glob **有没有可能**是某个勾产生的。按形状判断，不必把整棵树拉下来：
//   `g://**`      整个 genre 的勾
//   `g://a/b`     某一行（无通配）
//   `g://a/b/**`  那一行的子树
// 别的形状（`wiki://legacy/*/draft` 这种中间带 `*` 的）没有任何一个勾能产生，所以树上不会有勾为它
// 亮起来 —— 得如实告诉 owner「它还在，只是不在树上」，而不是让它看起来凭空消失。
//
// 只看前缀不够（picker 第一版就是那样，于是 `wiki://legacy/*/draft` 被当成树能表达的）：它确实以
// `wiki://` 开头，却不是任何一行。判定住在这里而不是组件里 —— 这是 glob 方言的知识，不是渲染。
export function isTreeExpressible(glob: string): boolean {
  const genre = SCOPE_GENRES.find((x) => glob.startsWith(`${x}://`));
  const rest = genre === undefined ? '' : glob.slice(`${genre}://`.length);
  const body = rest.endsWith('/**') ? rest.slice(0, -3) : rest;
  return genre !== undefined && (rest === '**' || !body.includes('*'));
}

// foreignGlobs —— value 里树表达不了的那些（原样保留，且要显示给 owner）。
export function foreignGlobs(value: readonly string[]): string[] {
  return value.filter((g) => !isTreeExpressible(g));
}
