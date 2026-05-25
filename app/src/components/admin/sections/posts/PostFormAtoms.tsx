// PostFormAtoms —— admin posts Create / Edit 表单共用的小部件。
// 纯 presentational + 各自挂 data-testid 给 e2e。

'use client';

import type { ReactNode } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { BlogEditor } from '@/components/blog/editor';

export function PostFieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

export function PostField({
  label, value, onChange, placeholder, readOnly,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</span>
      <input
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px] disabled:opacity-60"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`post-field-${label.replace(/ /g, '-')}`}
      />
    </label>
  );
}

export type CoverHue = 'amber' | 'violet' | 'acid';

export function CoverHueSelect({
  value, onChange,
}: { value: CoverHue; onChange: (v: CoverHue) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">cover hue</span>
      <select
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        onChange={(e) => onChange(e.target.value as CoverHue)}
        data-testid="post-field-cover-hue"
      >
        <option value="amber">amber</option>
        <option value="violet">violet</option>
        <option value="acid">acid</option>
      </select>
    </label>
  );
}

export function PostBodyField({
  value, onChange, assetURLs,
}: {
  value: string;
  onChange: (v: string) => void;
  assetURLs?: Record<string, string>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        body
      </span>
      <BlogEditor value={value} onChange={onChange} assetURLs={assetURLs} />
    </label>
  );
}

export function PostFormFooter({
  submitLabel, submitTestId, footerLeft, onClose, onSubmit,
}: {
  submitLabel: string;
  submitTestId: string;
  footerLeft?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex justify-between items-baseline mt-2">
      <div>{footerLeft}</div>
      <div className="flex gap-3">
        <Btn kind="ghost" onClick={onClose}>cancel</Btn>
        <button
          type="button"
          data-testid={submitTestId}
          onClick={onSubmit}
          className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function PublishToggle({
  publish, onTogglePublish,
}: { publish: boolean; onTogglePublish: () => void }) {
  return (
    <label className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-2">
      <input
        type="checkbox"
        checked={publish}
        onChange={onTogglePublish}
        data-testid="post-field-publish"
      />
      publish immediately
    </label>
  );
}
