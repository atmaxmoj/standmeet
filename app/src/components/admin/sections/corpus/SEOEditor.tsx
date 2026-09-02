// SEOEditor —— the public-landing SEO sub-section shared by wiki / output.
// Fields: excerpt / published. Only indexed=true enters the sitemap and
// renders /wiki/<path> or /output/<path>. The address (path) is purely
// derived from the tree (title slug + parent chain) — the owner no longer
// sets it themselves, so there's no path input field here; renaming also
// changes the public URL.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { SEOUpdateInput } from '@/lib/admin/use-corpus-actions';

export interface SEOEditorInitial {
  excerpt: string;
  published: boolean;
}

export interface SEOEditorProps {
  testidPrefix: string;
  initial: SEOEditorInitial;
  busy: boolean;
  onSave: (input: SEOUpdateInput) => void;
}

export function SEOEditor(props: SEOEditorProps) {
  const state = useSEOState(props.initial);
  const onSave = () => props.onSave({
    excerpt: state.description,
    published: state.indexed,
  });
  return (
    <div className="space-y-3 border border-(--color-rule) p-4 bg-(--color-surface)/40 rounded-sm mt-3"
      data-testid={`${props.testidPrefix}-seo-form`}>
      <Heading />
      <DescriptionField state={state} testid={props.testidPrefix} />
      <IndexedField state={state} testid={props.testidPrefix} />
      <Actions busy={props.busy} onSave={onSave} testid={props.testidPrefix} />
    </div>
  );
}

interface SEOState {
  description: string;
  indexed: boolean;
  setDescription: (v: string) => void;
  setIndexed: (b: boolean) => void;
}

function useSEOState(initial: SEOEditorInitial): SEOState {
  const [description, setDescription] = useState(initial.excerpt);
  const [indexed, setIndexed] = useState(initial.published);
  return { description, indexed, setDescription, setIndexed };
}

function Heading() {
  const t = useTranslations('adminCorpus.seoEditor');
  return (
    <h4 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
      {t('heading')}
    </h4>
  );
}

function DescriptionField({ state, testid }: { state: SEOState; testid: string }) {
  const t = useTranslations('adminCorpus.seoEditor');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('description')}
      </span>
      <textarea
        rows={2}
        value={state.description}
        onChange={(e) => state.setDescription(e.target.value)}
        spellCheck={false}
        placeholder="One-line summary for og:description"
        data-testid={`${testid}-seo-description`}
        className="w-full bg-transparent border border-(--color-rule) p-2 reading-tight text-[14px]"
      />
    </label>
  );
}

function IndexedField({ state, testid }: { state: SEOState; testid: string }) {
  const t = useTranslations('adminCorpus.seoEditor');
  return (
    <label className="flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em]">
      <input
        type="checkbox"
        checked={state.indexed}
        onChange={(e) => state.setIndexed(e.target.checked)}
        data-testid={`${testid}-seo-indexed`}
      />
      <span>{t('indexed')}</span>
    </label>
  );
}

interface ActionsProps {
  busy: boolean;
  onSave: () => void;
  testid: string;
}

// Actions —— this card's own submit.
//
// This screen has **two independent SAVEs**: the CorpusEntryForm above
// (body/tags/cover) goes through `onSubmit`, and this PUBLIC LANDING card
// goes through `onSave` — they submit different things. Both used to just say
// "save" — after filling in the bottom half, the owner's most natural move is
// to click the more prominent solid button above, and that button **doesn't
// cover this half** (UX-60). Nothing on screen marked the boundary or an
// "unsaved" state; two submit boundaries stacked in one scrolling pane, left
// to guesswork.
//
// The fix isn't adding a third "save all" button — that would hide two
// backend calls inside one action, making things harder to reason about.
// Instead each button **names which half it owns**: that's the only
// information the owner can use to judge "which one do I press".
function Actions(props: ActionsProps) {
  const t = useTranslations('adminCorpus.common');
  return (
    <div className="flex items-baseline justify-end pt-2">
      <button
        type="button"
        onClick={props.onSave}
        disabled={props.busy}
        data-testid={`${props.testid}-seo-save`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {props.busy ? t('saving') : t('saveLanding')}
      </button>
    </div>
  );
}
