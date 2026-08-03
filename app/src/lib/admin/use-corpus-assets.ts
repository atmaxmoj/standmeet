// use-corpus-assets —— 一条语料身上的文件:列出来、传上去、撤下来。
//
// 在这之前面板上**没有任何**挂文件的入口。后端从 2026-07 起每个 genre 都能挂素材,
// 访客的阅读页也渲染得出来,但 owner 想给一条 wiki 配张图,只有一条路:去 Claude Code
// 里让 AI 调 MCP。面板上有一个写着 "attach media" 的按钮,没有 onClick ——
// 一个只说不做的标签。
//
// 列表**从条目详情来**,不另开一条 `GET .../assets`:素材依附文章,没有独立的权限,
// 也就不该有独立的读法。多一条按 id 取素材的路,就多一处要单独守可见性的地方。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useReportError } from '@/lib/ui/use-report-error';

// CorpusAssetSchema —— 一份素材读回来的样子。下载按钮要的就是这几项。
const CorpusAssetSchema = z.object({
  asset_id: z.string(),
  kind: z.string(),
  content_type: z.string(),
  original_filename: z.string(),
  url: z.string().nullish().transform((v) => v ?? ''),
  size_bytes: z.number(),
});
export type CorpusAsset = z.infer<typeof CorpusAssetSchema>;

// 详情里只取素材那一段。omitempty 意味着"一个都没有"时字段直接不在 —— 那是空数组,
// 不是坏了。
const EntryAssetsSchema = z.object({
  assets: z.array(CorpusAssetSchema).nullish().transform((v) => v ?? []),
});

export interface CorpusAssetsHook {
  assets: readonly CorpusAsset[];
  busy: boolean;
  // uploadPicked —— 文件挑选框给的可能是 undefined(owner 打开又取消)。判空放这儿,
  // 不放渲染层 —— 那边不许有 if,而"没选文件"也确实不是渲染的事。
  uploadPicked: (file: File | undefined, kind: string) => Promise<CorpusAsset | null>;
  remove: (assetID: string) => Promise<boolean>;
  reload: () => Promise<void>;
}

/** useCorpusAssets —— genre + 条目 id 上的素材。 */
export function useCorpusAssets(genre: string, entryID: string): CorpusAssetsHook {
  const [assets, setAssets] = useState<readonly CorpusAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const report = useReportError();

  const reload = useCallback(async () => {
    const got = await adminAPI.get(`/corpus/${genre}/${entryID}`, EntryAssetsSchema);
    setAssets(got.assets);
  }, [genre, entryID]);

  useEffect(() => { void reload().catch((e: unknown) => { report(e); }); }, [reload, report]);

  return {
    assets, busy,
    uploadPicked: useCallback(async (file: File | undefined, kind: string) => {
      if (!file) return null;
      setBusy(true);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('kind', kind);
        const made = await adminAPI.postForm(
          `/corpus/${genre}/${entryID}/assets`, form, CorpusAssetSchema);
        await reload();
        return made;
      } finally {
        setBusy(false);
      }
    }, [genre, entryID, reload]),
    remove: useCallback(async (assetID: string) => {
      setBusy(true);
      try {
        await adminAPI.deleteVoid(`/corpus/${genre}/${entryID}/assets/${assetID}`);
        await reload();
        return true;
      } finally {
        setBusy(false);
      }
    }, [genre, entryID, reload]),
    reload,
  };
}

// clearFileInput —— 传完把挑选框清空,否则 owner 再选同一个文件不会触发 change,
// 看上去像"点了没反应"。
export function clearFileInput(el: HTMLInputElement | null): void {
  if (el) el.value = '';
}

// 面板上那一行要说**真实大小**。owner 传完一份文件,唯一能核对"传上去的是不是我选的那份"
// 的东西就是它;写个"已上传"等于什么都没说。访客那边的下载区用同一个 formatBytes ——
// 说的是同一件事,就不该有两份实现(见 lib/format/bytes.ts)。
export { formatBytes } from '@/lib/format/bytes';
