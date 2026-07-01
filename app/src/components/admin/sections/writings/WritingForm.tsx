// WritingForm —— admin writings 共用表单。Create / Edit 两个调用方共用 fields
// state + atoms；不同点：
//   - Create: slug 可编辑 + 有 publish checkbox + onSubmit 走 createWriting
//   - Edit:   slug readonly + 无 publish 切换 (走单独 publish endpoint) +
//             onSubmit 走 updateWriting
//
// initial 是预填值（edit 必传，create 不传），由调用方组成。

'use client';

import { useCallback, useRef, useState } from 'react';

import { CoverImagePicker, type CoverAssetState } from '@/components/admin/sections/writings/CoverImagePicker';
import { EditorSideRail } from '@/components/admin/sections/writings/EditorSideRail';
import {
  WritingField, WritingFieldRow, CoverHueSelect, WritingBodyField,
  WritingFormFooter, PublishToggle, ParentSelect,
  type CoverHue,
} from '@/components/admin/sections/writings/WritingFormAtoms';
import type { PendingFile } from '@/lib/writings/upload-asset';
import { useToast } from '@/lib/ui/toast';
import { useReportError } from '@/lib/ui/use-report-error';

export interface WritingFormValues {
  slug: string;
  title: string;
  excerpt: string;
  bodyMD: string;
  coverHeadline: string;
  coverSub: string;
  coverHue: CoverHue;
  coverAsset: CoverAssetState;
  tags: string;
  parentID: string;
  publish: boolean;
}

// ParentOption —— 「设父」下拉的一项(别的 writing)。
export interface ParentOption {
  id: string;
  title: string;
}

// WritingFormSubmit —— values + 待上传 files。caller 在 WritingsSection 里
// 把这个转 WritingSaveBundle 进 createWriting / updateWriting。
export interface WritingFormSubmit {
  values: WritingFormValues;
  files: PendingFile[];
}

export const EMPTY_VALUES: WritingFormValues = {
  slug: '', title: '', excerpt: '', bodyMD: '',
  coverHeadline: '', coverSub: '', coverHue: 'amber',
  coverAsset: { id: '', url: '' },
  tags: '', parentID: '', publish: true,
};

interface Props {
  heading: string;
  initial: WritingFormValues;
  slugReadOnly: boolean;
  showPublishToggle: boolean;
  submitLabel: string;
  submitTestId: string;
  // parentOptions —— 「设父」下拉的候选(别的 writing;edit 时已排除自己)。
  parentOptions: ParentOption[];
  // assetURLs —— editor body 内 standmeet-asset:<id> 引用的预解析 URL map。
  // create 时空（{}），edit 时由 caller 从 AdminWritingView.asset_urls 传。
  assetURLs?: Record<string, string>;
  onClose: () => void;
  onSubmit: (s: WritingFormSubmit) => Promise<void>;
}

export function WritingForm(props: Props) {
  const [values, setValues] = useState<WritingFormValues>(props.initial);
  const pendingRef = useRef<PendingFile[]>([]);
  const toast = useToast();
  const report = useReportError();
  const submit = useSubmitHandler(values, pendingRef, props, toast, report);
  return (
    <div className="bg-(--color-paper) border border-(--color-rule) max-w-[720px] w-full max-h-[90vh] overflow-y-auto p-7 flex flex-col gap-4">
      <h2 className="font-serif text-[22px]">{props.heading}</h2>
      <WritingFormBody values={values} setValues={setValues}
        props={props} toast={toast} pendingRef={pendingRef} />
      <WritingFormFooter
        submitLabel={props.submitLabel}
        submitTestId={props.submitTestId}
        footerLeft={props.showPublishToggle
          ? <PublishToggle publish={values.publish}
              onTogglePublish={() => setValues({ ...values, publish: !values.publish })} />
          : null}
        onClose={props.onClose}
        onSubmit={() => void submit()}
      />
    </div>
  );
}

function WritingFormBody({
  values, setValues, props, toast, pendingRef,
}: {
  values: WritingFormValues;
  setValues: (v: WritingFormValues) => void;
  props: Props;
  toast: ReturnType<typeof useToast>;
  pendingRef: { current: PendingFile[] };
}) {
  const set = <K extends keyof WritingFormValues>(k: K, v: WritingFormValues[K]) =>
    setValues({ ...values, [k]: v });
  const handlePending = (p: PendingFile) => {
    pendingRef.current = [...pendingRef.current.filter((x) => x.id !== p.id), p];
  };
  return (
    <>
      <WritingFieldRow>
        <WritingField label="slug" value={values.slug}
          onChange={(v) => set('slug', v)}
          placeholder="url-slug" readOnly={props.slugReadOnly} />
        <WritingField label="title" value={values.title}
          onChange={(v) => set('title', v)} placeholder="Writing title" />
      </WritingFieldRow>
      <WritingField label="excerpt" value={values.excerpt}
        onChange={(v) => set('excerpt', v)} placeholder="One-line summary" />
      <WritingFieldRow>
        <WritingField label="cover headline" value={values.coverHeadline}
          onChange={(v) => set('coverHeadline', v)} placeholder="Big headline" />
        <WritingField label="cover sub" value={values.coverSub}
          onChange={(v) => set('coverSub', v)} placeholder="Italic subline" />
      </WritingFieldRow>
      <WritingFieldRow>
        <CoverHueSelect value={values.coverHue}
          onChange={(v) => set('coverHue', v)} />
        <WritingField label="tags" value={values.tags}
          onChange={(v) => set('tags', v)} placeholder="comma, separated" />
      </WritingFieldRow>
      <ParentSelect value={values.parentID} options={props.parentOptions}
        onChange={(v) => set('parentID', v)} />
      <CoverImagePicker value={values.coverAsset}
        onChange={(v) => set('coverAsset', v)}
        onPending={handlePending} toast={toast} />
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        <WritingBodyField value={values.bodyMD}
          onChange={(v) => set('bodyMD', v)}
          assetURLs={props.assetURLs} onPending={handlePending} />
        <EditorSideRail bodyMD={values.bodyMD} />
      </div>
    </>
  );
}

type Reporter = ReturnType<typeof useReportError>;

function useSubmitHandler(
  values: WritingFormValues, pendingRef: { current: PendingFile[] },
  props: Props, toast: ReturnType<typeof useToast>, report: Reporter,
) {
  return useCallback(async () => {
    await runSubmit(values, pendingRef.current, props, toast, report);
  }, [values, pendingRef, props, toast, report]);
}

async function runSubmit(
  values: WritingFormValues, files: PendingFile[],
  props: Props, toast: ReturnType<typeof useToast>, report: Reporter,
): Promise<void> {
  isValid(values) && await doSubmit(values, files, props, toast, report);
}

function isValid(v: WritingFormValues): boolean {
  return v.slug !== '' && v.title !== '';
}

// 提交：成功 → toast + 关；失败 → report + **保持表单开着**（owner 可能有大段草稿，别丢）。
async function doSubmit(
  values: WritingFormValues, files: PendingFile[],
  props: Props, toast: ReturnType<typeof useToast>, report: Reporter,
): Promise<void> {
  try {
    await props.onSubmit({ values, files });
    toast.success(`Writing ${values.slug} saved`);
    props.onClose();
  } catch (e) {
    report(e);
  }
}
