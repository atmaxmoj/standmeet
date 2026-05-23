// SEOEditor —— wiki / output 共用的 path + SEO sub-section。
// 字段：path（可空=不公开 + 不算 retrieval ACL）/ seo_description / seo_indexed。
// owner 改完保存，indexed=true 才会进 sitemap + 渲染 /wiki/<path> 或 /output/<path>。
// path 现在允许包含 `/`（例：projects/lucerna）—— retrieval ACL 走 path-glob，
// landing route 用 catch-all [...path]。

'use client';

import { useState } from 'react';

import type { PathUpdateInput } from '@/lib/admin/use-corpus-actions';

export interface SEOEditorInitial {
  path?: string | null;
  seo_description: string;
  seo_indexed: boolean;
}

export interface SEOEditorProps {
  testidPrefix: string;
  initial: SEOEditorInitial;
  busy: boolean;
  onSave: (input: PathUpdateInput) => void;
}

export function SEOEditor(props: SEOEditorProps) {
  const state = useSEOState(props.initial);
  const onSave = () => props.onSave({
    path: normalizePath(state.path),
    seo_description: state.description,
    seo_indexed: state.indexed,
  });
  return (
    <div className="space-y-3 border border-(--color-rule) p-4 bg-(--color-surface)/40 rounded-sm mt-3"
      data-testid={`${props.testidPrefix}-seo-form`}>
      <Heading />
      <PathField state={state} testid={props.testidPrefix} />
      <DescriptionField state={state} testid={props.testidPrefix} />
      <IndexedField state={state} testid={props.testidPrefix} />
      <Actions busy={props.busy} onSave={onSave} testid={props.testidPrefix} />
    </div>
  );
}

interface SEOState {
  path: string;
  description: string;
  indexed: boolean;
  setPath: (v: string) => void;
  setDescription: (v: string) => void;
  setIndexed: (b: boolean) => void;
}

function useSEOState(initial: SEOEditorInitial): SEOState {
  const [path, setPath] = useState(initial.path ?? '');
  const [description, setDescription] = useState(initial.seo_description);
  const [indexed, setIndexed] = useState(initial.seo_indexed);
  return { path, description, indexed, setPath, setDescription, setIndexed };
}

function normalizePath(s: string): string | null {
  const trimmed = s.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

function Heading() {
  return (
    <h4 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
      path &amp; public landing
    </h4>
  );
}

function PathField({ state, testid }: { state: SEOState; testid: string }) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        path (empty = not public; `/` allowed for grouping)
      </span>
      <input
        type="text"
        value={state.path}
        onChange={(e) => state.setPath(e.target.value)}
        spellCheck={false}
        placeholder="projects/lucerna"
        data-testid={`${testid}-path`}
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
        {props.busy ? 'saving…' : 'save'}
      </button>
    </div>
  );
}
