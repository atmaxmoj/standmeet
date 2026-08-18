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
import { runWith, savedLine } from '@/lib/admin/use-corpus-form';
import { useToast } from '@/lib/ui/toast';
import type { WikiSummary } from '@/lib/admin/use-wiki';

export function WikiEditForm({
  entry, actions, onDone,
}: { entry: WikiSummary; actions: CorpusActionsHook; onDone: () => void }) {
  const t = useTranslations('adminCorpus.common');
  const tf = useTranslations('adminCorpus.form');
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
              cover_headline: detail.cover_headline,
              cover_hue: detail.cover_hue,
            }}
            busy={actions.pending}
            // "save entry" 而不是 "save"：这一屏下面还有一张 PUBLIC LANDING 卡，
            // 带**它自己**的提交。两个都只写 save 的时候，owner 填完下半张最自然会去按
            // 上面这个更显眼的按钮，而它不管那一半（UX-60）。
            heading={tf('entryHeading')}
            submitLabel="save entry"
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

// saveWikiSEO —— 保存 + **说出这一次真的做成了什么**。
//
// 取消发布一条被 pin 的笔记会把它从首页那几个栏目里摘掉（不变量的另一端）。owner 一次点击
// 做成了两件事，而上一版只回一句 "Wiki saved" —— 他下次打开 landing page 会看见一个空掉的
// 区块，没有任何线索说是什么时候没的（F-L-31）。回执后端一直在发，是客户端把响应扔了。
async function saveWikiSEO(
  id: string,
  actions: CorpusActionsHook,
  toast: { success: (m: string) => void },
  input: SEOUpdateInput,
): Promise<void> {
  const res = await actions.updateWikiSEO(id, input);
  res && toast.success(savedLine(res.unpinned_sections));
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
