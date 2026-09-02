// WritingForm —— the shared form for admin writings. Create / Edit callers
// share the fields state + atoms; the differences:
//   - Create: slug is editable + has a publish checkbox + onSubmit goes through createWriting
//   - Edit:   slug is readonly + no publish toggle (uses a separate publish endpoint) +
//             onSubmit goes through updateWriting
//
// initial is the prefill value (required for edit, omitted for create), built by the caller.

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
  coverHue: CoverHue;
  coverAsset: CoverAssetState;
  tags: string;
  parentID: string;
  publish: boolean;
}

// ParentOption —— one entry in the "set parent" dropdown (another writing).
export interface ParentOption {
  id: string;
  title: string;
}

// WritingFormSubmit —— values + files pending upload. The caller in
// WritingsSection converts this into a WritingSaveBundle for createWriting / updateWriting.
export interface WritingFormSubmit {
  values: WritingFormValues;
  files: PendingFile[];
}

export const EMPTY_VALUES: WritingFormValues = {
  slug: '', title: '', excerpt: '', bodyMD: '',
  coverHeadline: '', coverHue: 'amber',
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
  // parentOptions —— candidates for the "set parent" dropdown (other writings;
  // self already excluded on edit).
  parentOptions: ParentOption[];
  // assetURLs —— pre-resolved URL map for standmeet-asset:<id> refs inside the editor body.
  // Empty ({}) on create; passed by the caller from AdminWritingView.asset_urls on edit.
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
      {/* excerpt is written once, shared by the card / og / cover subline */}
      <WritingField label="excerpt" value={values.excerpt}
        onChange={(v) => set('excerpt', v)} placeholder="One-line summary (also the cover subline)" />
      <WritingField label="cover headline" value={values.coverHeadline}
        onChange={(v) => set('coverHeadline', v)} placeholder="Big headline" />
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

// Submit: success → toast + close; failure → report + **keep the form open**
// (the owner may have a long draft in it — don't lose it).
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
