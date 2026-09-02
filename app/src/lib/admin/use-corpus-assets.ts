// use-corpus-assets —— the files attached to one corpus entry: list, upload, remove.
//
// Before this, the panel had **no** entry point at all for attaching files.
// The backend has let every genre carry assets since 2026-07, and the
// visitor-facing reading page already renders them, but if the owner wanted
// to attach an image to a wiki entry, there was exactly one way: go into
// Claude Code and have the AI call MCP. The panel had a button labeled
// "attach media" with no onClick — a label that only talked, never did anything.
//
// The list **comes from the entry's detail**, not a separate `GET .../assets`
// endpoint: assets belong to the article, they carry no independent
// permission of their own, so they shouldn't have an independent way to read
// them either. One more path to fetch assets by id is one more place that needs its own visibility guard.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useReportError } from '@/lib/ui/use-report-error';

// CorpusAssetSchema —— what one asset looks like read back. The download button needs exactly these fields.
const CorpusAssetSchema = z.object({
  asset_id: z.string(),
  kind: z.string(),
  content_type: z.string(),
  original_filename: z.string(),
  url: z.string().nullish().transform((v) => v ?? ''),
  size_bytes: z.number(),
});
export type CorpusAsset = z.infer<typeof CorpusAssetSchema>;

// Only the assets slice is taken from the detail. omitempty means the field
// is simply absent when there are zero — that's an empty array, not broken.
const EntryAssetsSchema = z.object({
  assets: z.array(CorpusAssetSchema).nullish().transform((v) => v ?? []),
});

export interface CorpusAssetsHook {
  assets: readonly CorpusAsset[];
  busy: boolean;
  // uploadPicked —— the file picker may hand back undefined (owner opened it
  // then cancelled). The null-check lives here, not in the render layer —
  // that layer bans if, and "no file chosen" genuinely isn't a rendering concern.
  uploadPicked: (file: File | undefined, kind: string) => Promise<CorpusAsset | null>;
  remove: (assetID: string) => Promise<boolean>;
  reload: () => Promise<void>;
}

/** useCorpusAssets —— assets on a genre + entry id. */
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

// clearFileInput —— clears the picker after uploading; otherwise the owner
// choosing the same file again won't trigger change, and looks like "clicking did nothing".
export function clearFileInput(el: HTMLInputElement | null): void {
  if (el) el.value = '';
}

// The panel's row must state the **real size**. Once the owner uploads a
// file, this is the only thing they can check "is what got uploaded the file
// I actually picked" against; writing "uploaded" would say nothing at all.
// The visitor-side download area uses the same formatBytes — it says the
// same thing, so it shouldn't have a second implementation (see lib/format/bytes.ts).
export { formatBytes } from '@/lib/format/bytes';
