// use-genre-tags —— 一个 genre 用过的**全部**标签(语料级),给面板的标签行用。
//
// 标签行以前是 `distinctTags(rows)` —— 从已加载的那一页推。于是只存在于那一页之外的标签
// **连 chip 都没有**:点不到,也就无从发现自己漏了什么。真 vault 上 `rate-reduction` 就是这样
// 消失的,而它所在的那条笔记正是我要去驱的目标(F-L-23 的后半条)。
//
// 语料变了要重取:跟分页共用 corpus epoch,一次写入之后标签行不会停在旧答案上。

'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';

const TagsSchema = z.object({ tags: z.array(z.string()) });

/** 一个 genre 的全部标签。取不到就回空数组 —— 标签行少一行,好过整页崩掉。 */
export function useGenreTags(genre: string): readonly string[] {
  const epoch = useCorpusEpoch();
  const [tags, setTags] = useState<readonly string[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const resp = await adminAPI.get(`/corpus/${genre}/tags`, TagsSchema);
        if (alive) setTags(resp.tags);
      } catch {
        if (alive) setTags([]);
      }
    })();
    return () => { alive = false; };
  }, [genre, epoch]);
  return tags;
}
