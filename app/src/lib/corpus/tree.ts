// tree.ts —— 中性树节点形状,LazyTree 组件 + 各 corpus 树数据源(wiki / output /
// writing)共用。一次一层(懒加载):has_children 决定要不要画展开箭头,展开才取下层。
// 跟后端 GET /api/v1/wiki-tree 的节点形状对齐;path 跟 landing 同口径(树派生)。

import { z } from 'zod';

export const TreeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  // path —— 导航 + testid 的稳定键。wiki = 树派生 path;writing = slug
  //(writing 的"路径"就是它的 slug,landing 是 /writings/<slug>)。
  //
  // ⚠️ **这个字段的含义按体裁不同**,所以别拿它自己拼地址。同一个名字装两种东西,
  // 曾经让 `/${genre}/${path}` 这一句在 wiki 上对、在 writing 上渲出 404
  // (`/writing/writings/<slug>`,prod 上那唯一一篇公开 writing 的引用)。
  // 要地址就走 `lib/corpus/href.ts` 的 `corpusHref` —— 哪种体裁用哪个标识只写在那里,
  // 而闸门 `check-one-corpus-href` 不许别处再拼一份。
  path: z.string(),
  has_children: z.boolean(),
  // locked —— writing private 节点(teaser only)。wiki 不带,可选。
  locked: z.boolean().optional(),
});

export type TreeNode = z.infer<typeof TreeNodeSchema>;

export const TreeResponseSchema = z.object({ nodes: z.array(TreeNodeSchema) });

// TreeContext —— 一个节点的 breadcrumb 祖先链(root→parent)+ 直接子(sub-rail)。
export const TreeContextSchema = z.object({
  ancestors: z.array(TreeNodeSchema),
  children: z.array(TreeNodeSchema),
});

export type TreeContext = z.infer<typeof TreeContextSchema>;

export const EMPTY_TREE_CONTEXT: TreeContext = { ancestors: [], children: [] };

// TreeLoader —— LazyTree 的数据口:给 parentId(''=roots)返回该层直接子节点。
export type TreeLoader = (parentId: string) => Promise<TreeNode[]>;
