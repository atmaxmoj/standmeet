// OutputRowForms — the inline edit form inside an output row.
// Split out of OutputSection.tsx to stay under the 350-line max-lines cap
// (mirrors WikiRowForms on the wiki side).

'use client';

import { useTranslations } from 'next-intl';

import { CorpusAssetsPanel } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { SEOEditor } from '@/components/admin/sections/corpus/SEOEditor';
import {
  type CorpusActionsHook, type CorpusEntryInput, type SEOUpdateInput,
} from '@/lib/admin/use-corpus-actions';
import { useOutputDetail } from '@/lib/admin/use-corpus-detail';
import { runWith, savedLine } from '@/lib/admin/use-corpus-form';
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

// OutputEditDetail — the fields an output edit needs read back. Used to be an
// inline literal type; missing a field there silently dropped it —
// show_as_source got lost that way.
interface OutputEditDetail {
  title: string;
  body: string;
  tags: string[];
  path?: string | null;
  excerpt: string;
  published: boolean;
  show_as_source: boolean;
  cover_image_asset_id: string;
  cover_headline: string;
  cover_hue: string;
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
  const tf = useTranslations('adminCorpus.form');
  return (
    <>
      <CorpusEntryForm
        initial={{
          title: detail.title, body: detail.body, tags: detail.tags,
          // show_as_source used to not be passed — the form defaulted to true,
          // so every save flipped a reference the owner had deliberately turned
          // off back on. The checkbox in the UI looked entirely normal; it just
          // wasn't read from this output entry.
          show_as_source: detail.show_as_source,
          cover_image_asset_id: detail.cover_image_asset_id,
          cover_headline: detail.cover_headline,
          cover_hue: detail.cover_hue,
        }}
        busy={actions.pending}
        // "save entry" + heading: same as wiki — this screen has a separate
        // PUBLIC LANDING card below with its own submit; each card names which
        // half it owns (UX-60).
        heading={tf('entryHeading')}
        submitLabel="save entry"
        testidPrefix={`output-edit-form-${entry.id}`}
        onSubmit={onSubmit}
        onCancel={onDone}
        renderAssets={(api) => (
          <CorpusAssetsPanel
            genre="output"
            entryID={entry.id}
            testidPrefix={`output-edit-form-${entry.id}`}
            insertIntoBody={api.insertIntoBody}
            dropFromBody={api.dropFromBody}
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

// saveOutputSEO — same as the wiki side: unpublishing pulls it off the
// homepage sections, and the receipt must say so (F-L-31).
async function saveOutputSEO(
  id: string, actions: CorpusActionsHook,
  toast: { success: (m: string) => void }, input: SEOUpdateInput,
): Promise<void> {
  const res = await actions.updateOutputSEO(id, input);
  res && toast.success(savedLine(res.unpinned_sections));
}
