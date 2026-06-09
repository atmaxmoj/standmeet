// SEOEditor —— wiki / output 共用的 public-landing SEO sub-section。
// 字段：seo_description / seo_indexed。indexed=true 才进 sitemap + 渲染
// /wiki/<path> 或 /output/<path>。地址(path)纯树派生(标题 slug + parent 链),
// owner 不再自设 —— 所以这里没有 path 输入框,改名会同时改公开 URL。

'use client';

import { useState } from 'react';

import type { SEOUpdateInput } from '@/lib/admin/use-corpus-actions';

export interface SEOEditorInitial {
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
    seo_description: state.description,
    seo_indexed: state.indexed,
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
  const [description, setDescription] = useState(initial.seo_description);
  const [indexed, setIndexed] = useState(initial.seo_indexed);
  return { description, indexed, setDescription, setIndexed };
}

function Heading() {
  return (
    <h4 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
      public landing (url is tree-derived from the title)
    </h4>
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
        {props.busy ? 'saving…' : 'save'}
      </button>
    </div>
  );
}
