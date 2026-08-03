// OutputRowForms —— output row 里那张 inline 编辑表单。
// 从 OutputSection.tsx 拆出来守 350 行 max-lines(跟 wiki 那边的 WikiRowForms 对称)。

'use client';

import { useTranslations } from 'next-intl';

import { CorpusAssetsPanel } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { SEOEditor } from '@/components/admin/sections/corpus/SEOEditor';
import {
  type CorpusActionsHook, type CorpusEntryInput, type SEOUpdateInput,
} from '@/lib/admin/use-corpus-actions';
import { useOutputDetail } from '@/lib/admin/use-corpus-detail';
import { runWith } from '@/lib/admin/use-corpus-form';
import type { OutputSummary } from '@/lib/admin/use-output';
import { useToast } from '@/lib/ui/toast';

export function OutputEditForm({
  entry, actions, onDone,
}: { entry: OutputSummary; actions: CorpusActionsHook; onDone: () => void }) {
  const t = useTranslations('adminCorpus.common');
  const toast = useToast();
  const detail = useOutputDetail(entry.id, actions);
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateOutput(entry.id, input),
    () => { toast.success('Output updated'); onDone(); },
  );
  return (
    <div className="mt-4" data-testid={`output-edit-loaded-${entry.id}`}>
      {detail ? (
        <EditFormBody
          entry={entry} detail={detail} actions={actions}
          onSubmit={onSubmit} onDone={onDone}
        />
      ) : (
        <p className="mono text-[10.5px] text-(--color-muted)">{t('loading')}</p>
      )}
    </div>
  );
}

// OutputEditDetail —— 编辑一条 output 要读回来的那些字段。以前是内联的字面类型,
// 少写一个字段就等于少传一个 —— show_as_source 就是这么丢的。
interface OutputEditDetail {
  title: string;
  body: string;
  tags: string[];
  path?: string | null;
  excerpt: string;
  published: boolean;
  show_as_source: boolean;
  cover_image_asset_id: string;
}

function EditFormBody({
  entry, detail, actions, onSubmit, onDone,
}: {
  entry: OutputSummary;
  detail: OutputEditDetail;
  actions: CorpusActionsHook;
  onSubmit: (input: CorpusEntryInput) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  return (
    <>
      <CorpusEntryForm
        initial={{
          title: detail.title, body: detail.body, tags: detail.tags,
          // show_as_source 以前没传 —— 表单缺省成 true,于是每保存一次就把 owner
          // 特意关掉的引用顶回打开。界面上那个勾看着完全正常,它只是不是从这条 output
          // 读来的。
          show_as_source: detail.show_as_source,
          cover_image_asset_id: detail.cover_image_asset_id,
        }}
        busy={actions.pending}
        submitLabel="save"
        testidPrefix={`output-edit-form-${entry.id}`}
        onSubmit={onSubmit}
        onCancel={onDone}
        renderAssets={(api) => (
          <CorpusAssetsPanel
            genre="output"
            entryID={entry.id}
            testidPrefix={`output-edit-form-${entry.id}`}
            insertIntoBody={api.insertIntoBody}
            onSetCover={api.setCover}
            coverAssetID={api.coverAssetID}
          />
        )}
      />
      <SEOEditor
        testidPrefix={`output-${entry.id}`}
        initial={{ excerpt: detail.excerpt, published: detail.published }}
        busy={actions.pending}
        onSave={(input: SEOUpdateInput) => void saveOutputSEO(entry.id, actions, toast, input)}
      />
    </>
  );
}

async function saveOutputSEO(
  id: string, actions: CorpusActionsHook,
  toast: { success: (m: string) => void }, input: SEOUpdateInput,
): Promise<void> {
  await runWith(
    () => actions.updateOutputSEO(id, input),
    () => toast.success('Output SEO saved'),
  );
}
