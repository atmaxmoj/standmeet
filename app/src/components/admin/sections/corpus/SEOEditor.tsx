// SEOEditor —— wiki / output 共用的 SEO sub-section。
// 字段：seo_slug（kebab-case，可空=不公开）/ seo_description / seo_indexed。
// owner 改完保存，indexed=true 才会进 sitemap + 渲染 /wiki/<slug> 或 /output/<slug>。

'use client';

import { useState } from 'react';

import type { SEOUpdateInput } from '@/lib/admin/use-corpus-actions';

export interface SEOEditorInitial {
  seo_slug?: string | null;
  seo_description: string;
  seo_indexed: boolean;
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
    seo_slug: normalizeSlug(state.slug),
    seo_description: state.description,
    seo_indexed: state.indexed,
  });
  return (
    <div className="space-y-3 border border-(--color-rule) p-4 bg-(--color-surface)/40 rounded-sm mt-3"
      data-testid={`${props.testidPrefix}-seo-form`}>
      <Heading />
      <SlugField state={state} testid={props.testidPrefix} />
      <DescriptionField state={state} testid={props.testidPrefix} />
      <IndexedField state={state} testid={props.testidPrefix} />
      <Actions busy={props.busy} onSave={onSave} testid={props.testidPrefix} />
    </div>
  );
}

interface SEOState {
  slug: string;
  description: string;
  indexed: boolean;
  setSlug: (v: string) => void;
  setDescription: (v: string) => void;
  setIndexed: (b: boolean) => void;
}

function useSEOState(initial: SEOEditorInitial): SEOState {
  const [slug, setSlug] = useState(initial.seo_slug ?? '');
  const [description, setDescription] = useState(initial.seo_description);
  const [indexed, setIndexed] = useState(initial.seo_indexed);
  return { slug, description, indexed, setSlug, setDescription, setIndexed };
}

function normalizeSlug(s: string): string | null {
  const trimmed = s.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

function Heading() {
  return (
    <h4 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
      SEO &amp; public landing
    </h4>
  );
}

function SlugField({ state, testid }: { state: SEOState; testid: string }) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        slug (empty = not public)
      </span>
      <input
        type="text"
        value={state.slug}
        onChange={(e) => state.setSlug(e.target.value)}
        spellCheck={false}
        placeholder="local-first-essay"
        data-testid={`${testid}-seo-slug`}
        className="w-full bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px]"
      />
    </label>
  );
}

function DescriptionField({ state, testid }: { state: SEOState; testid: string }) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        meta description
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
  return (
    <label className="flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em]">
      <input
        type="checkbox"
        checked={state.indexed}
        onChange={(e) => state.setIndexed(e.target.checked)}
        data-testid={`${testid}-seo-indexed`}
      />
      <span>include in sitemap.xml (let search engines find this)</span>
    </label>
  );
}

interface ActionsProps {
  busy: boolean;
  onSave: () => void;
  testid: string;
}

function Actions(props: ActionsProps) {
  return (
    <div className="flex items-baseline justify-end pt-2">
      <button
        type="button"
        onClick={props.onSave}
        disabled={props.busy}
        data-testid={`${props.testid}-seo-save`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {props.busy ? 'saving…' : 'save SEO'}
      </button>
    </div>
  );
}
