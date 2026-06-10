// tree.ts —— 中性树节点形状,LazyTree 组件 + 各 corpus 树数据源(wiki / output /
// writing)共用。一次一层(懒加载):has_children 决定要不要画展开箭头,展开才取下层。
// 跟后端 GET /api/v1/wiki-tree 的节点形状对齐;path 跟 landing 同口径(树派生)。

import { z } from 'zod';

export const TreeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  has_children: z.boolean(),
});

export type TreeNode = z.infer<typeof TreeNodeSchema>;

export const TreeResponseSchema = z.object({ nodes: z.array(TreeNodeSchema) });

// TreeLoader —— LazyTree 的数据口:给 parentId(''=roots)返回该层直接子节点。
export type TreeLoader = (parentId: string) => Promise<TreeNode[]>;
