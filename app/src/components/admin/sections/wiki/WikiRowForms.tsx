// WikiRowForms —— wiki row 内 edit / promote 两个 inline form 子组件。
// 从 WikiSection.tsx 拆出来守 350 行 max-lines。

'use client';

import { useTranslations } from 'next-intl';

import { CorpusAssetsPanel } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import { CorpusEntryForm, PromoteForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { SEOEditor } from '@/components/admin/sections/corpus/SEOEditor';
import { useWikiDetail } from '@/lib/admin/use-corpus-detail';
import {
  type CorpusActionsHook,
  type CorpusEntryInput,
  type PromoteInput,
  type SEOUpdateInput,
} from '@/lib/admin/use-corpus-actions';
import { runWith } from '@/lib/admin/use-corpus-form';
import { useToast } from '@/lib/ui/toast';
import type { WikiSummary } from '@/lib/admin/use-wiki';

export function WikiEditForm({
  entry, actions, onDone,
}: { entry: WikiSummary; actions: CorpusActionsHook; onDone: () => void }) {
  const t = useTranslations('adminCorpus.common');
  const toast = useToast();
  const detail = useWikiDetail(entry.id, actions);
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateWiki(entry.id, input),
    () => { toast.success('Wiki updated'); onDone(); },
  );
  // `wiki-edit-loaded-${id}` 只挂在**真的加载完**的那一支上。它以前在外层 div —— 于是 loading…
  // 期间它也在，一个自称 "loaded" 却不追踪 loaded 的标记。等它的测试会在表单还没渲染时就动手。
  return (
    <div className="mt-4" data-testid={`wiki-edit-${entry.id}-slot`}>
      {detail ? (
        <div data-testid={`wiki-edit-loaded-${entry.id}`}>
          <CorpusEntryForm
            initial={{
              title: detail.title,
              body: detail.body,
              tags: detail.tags,
              // seed the real value: the form now SENDS show_as_source, so seeding it wrong would
              // flip the note's citation on save (the Go request decodes a missing field as false).
              show_as_source: detail.show_as_source,
              cover_image_asset_id: detail.cover_image_asset_id,
            }}
            busy={actions.pending}
            submitLabel="save"
            testidPrefix={`wiki-edit-form-${entry.id}`}
            onSubmit={onSubmit}
            onCancel={onDone}
            renderAssets={(api) => (
              <CorpusAssetsPanel
                genre="wiki"
                entryID={entry.id}
                testidPrefix={`wiki-edit-form-${entry.id}`}
                insertIntoBody={api.insertIntoBody}
                onSetCover={api.setCover}
                coverAssetID={api.coverAssetID}
              />
            )}
          />
          <SEOEditor
            testidPrefix={`wiki-${entry.id}`}
            initial={{
              excerpt: detail.excerpt,
              published: detail.published,
            }}
            busy={actions.pending}
            onSave={(input: SEOUpdateInput) => void saveWikiSEO(entry.id, actions, toast, input)}
          />
        </div>
      ) : (
        <p className="mono text-[10.5px] text-(--color-muted)">{t('loading')}</p>
      )}
    </div>
  );
}

async function saveWikiSEO(
  id: string,
  actions: CorpusActionsHook,
  toast: { success: (m: string) => void },
  input: SEOUpdateInput,
): Promise<void> {
  await runWith(
    () => actions.updateWikiSEO(id, input),
    () => toast.success('Wiki saved'),
  );
}

export function WikiPromoteRow({
  entry, actions, onDone,
}: { entry: WikiSummary; actions: CorpusActionsHook; onDone: () => void }) {
  const toast = useToast();
  const onSubmit = (input: PromoteInput) => void runWith(
    () => actions.promoteWiki(entry.id, input),
    () => { toast.success('Promoted to output'); onDone(); },
  );
  return (
    <div className="mt-4">
      <PromoteForm
        busy={actions.pending}
        defaultTitle={entry.title}
        testidPrefix={`wiki-promote-form-${entry.id}`}
        onSubmit={onSubmit}
        onCancel={onDone}
      />
    </div>
  );
}
