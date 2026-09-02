// WikiRowForms — the two inline form subcomponents (edit / promote) inside a wiki row.
// Split out of WikiSection.tsx to stay under the 350-line max-lines limit.

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
  // `wiki-edit-loaded-${id}` is attached only to the branch that has ACTUALLY finished
  // loading. It used to sit on the outer div, so it was present during the loading… state
  // too — a marker that claims "loaded" but never tracked loading. A test waiting on it
  // would act before the form rendered.
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
            // "save entry" instead of "save": this screen also has a PUBLIC LANDING card
            // below with its OWN submit. When both just said "save", after filling the
            // bottom half an owner would naturally click this more prominent button above,
            // which doesn't cover that half (UX-60).
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
                dropFromBody={api.dropFromBody}
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

// saveWikiSEO — save + REPORT what this action actually did.
//
// Unpublishing a pinned note also drops it from the homepage sections (the other side of
// the invariant). One owner click does two things, but the old version only replied "Wiki
// saved" — next time they open the landing page they'd find an empty section with no clue
// when it disappeared (F-L-31). The backend always sent the receipt; the client discarded it.
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
