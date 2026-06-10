// WritingFormAtoms —— admin writings Create / Edit 表单共用的小部件。
// 纯 presentational + 各自挂 data-testid 给 e2e。

'use client';

import type { ReactNode } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { WritingEditor } from '@/components/writings/editor';
import type { PendingFile } from '@/lib/writings/upload-asset';

export function WritingFieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

export function WritingField({
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
        data-testid={`writing-field-${label.replace(/ /g, '-')}`}
      />
    </label>
  );
}

export type CoverHue = 'amber' | 'violet' | 'acid';
const COVER_HUES: readonly CoverHue[] = ['amber', 'violet', 'acid'];
function toCoverHue(s: string): CoverHue { return COVER_HUES.find((h) => h === s) ?? 'amber'; }

export function CoverHueSelect({
  value, onChange,
}: { value: CoverHue; onChange: (v: CoverHue) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">cover hue</span>
      <select
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        onChange={(e) => onChange(toCoverHue(e.target.value))}
        data-testid="writing-field-cover-hue"
      >
        <option value="amber">amber</option>
        <option value="violet">violet</option>
        <option value="acid">acid</option>
      </select>
    </label>
  );
}

// ParentSelect —— 「设父」下拉:reader 树里把这篇挂到某篇下。「— none —」= root。
// 选项由 caller 给(别的 writing);成环(挂到自己子孙下)由后端 reparent 校验拦 400。
export function ParentSelect({
  value, options, onChange,
}: { value: string; options: { id: string; title: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        parent (reader tree)
      </span>
      <select
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="writing-field-parent"
      >
        <option value="">— none (root) —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
      </select>
    </label>
  );
}

export function WritingBodyField({
  value, onChange, assetURLs, onPending,
}: {
  value: string;
  onChange: (v: string) => void;
  assetURLs?: Record<string, string>;
  onPending?: (p: PendingFile) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        body
      </span>
      <WritingEditor value={value} onChange={onChange}
        assetURLs={assetURLs} onPending={onPending} />
    </label>
  );
}

export function WritingFormFooter({
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
        data-testid="writing-field-publish"
      />
      publish immediately
    </label>
  );
}
