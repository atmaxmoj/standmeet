// WikiRowForms —— wiki row 内 edit / promote 两个 inline form 子组件。
// 从 WikiSection.tsx 拆出来守 350 行 max-lines。

'use client';

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
  const toast = useToast();
  const detail = useWikiDetail(entry.id, actions);
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateWiki(entry.id, input),
    () => { toast.success('Wiki updated'); onDone(); },
  );
  return (
    <div className="mt-4" data-testid={`wiki-edit-loaded-${entry.id}`}>
      {detail ? (
        <>
          <CorpusEntryForm
            initial={{
              title: detail.title,
              body: detail.body,
              tags: detail.tags,
            }}
            busy={actions.pending}
            submitLabel="save"
            testidPrefix={`wiki-edit-form-${entry.id}`}
            onSubmit={onSubmit}
            onCancel={onDone}
          />
          <SEOEditor
            testidPrefix={`wiki-${entry.id}`}
            initial={{
              seo_description: detail.seo_description,
              seo_indexed: detail.seo_indexed,
            }}
            busy={actions.pending}
            onSave={(input: SEOUpdateInput) => void saveWikiSEO(entry.id, actions, toast, input)}
          />
        </>
      ) : (
        <p className="mono text-[10.5px] text-(--color-muted)">loading…</p>
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
