// PostForm —— admin posts 共用表单。Create / Edit 两个调用方共用 fields
// state + atoms；不同点：
//   - Create: slug 可编辑 + 有 publish checkbox + onSubmit 走 createPost
//   - Edit:   slug readonly + 无 publish 切换 (走单独 publish endpoint) +
//             onSubmit 走 updatePost
//
// initial 是预填值（edit 必传，create 不传），由调用方组成。

'use client';

import { useCallback, useRef, useState } from 'react';

import { CoverImagePicker, type CoverAssetState } from '@/components/admin/sections/posts/CoverImagePicker';
import {
  PostField, PostFieldRow, CoverHueSelect, PostBodyField,
  PostFormFooter, PublishToggle,
  type CoverHue,
} from '@/components/admin/sections/posts/PostFormAtoms';
import type { PendingFile } from '@/lib/blog/upload-asset';
import { useToast } from '@/lib/ui/toast';

export interface PostFormValues {
  slug: string;
  title: string;
  excerpt: string;
  bodyMD: string;
  coverHeadline: string;
  coverSub: string;
  coverHue: CoverHue;
  coverAsset: CoverAssetState;
  tags: string;
  publish: boolean;
}

// PostFormSubmit —— values + 待上传 files。caller 在 PostsSection 里
// 把这个转 PostSaveBundle 进 createPost / updatePost。
export interface PostFormSubmit {
  values: PostFormValues;
  files: PendingFile[];
}

export const EMPTY_VALUES: PostFormValues = {
  slug: '', title: '', excerpt: '', bodyMD: '',
  coverHeadline: '', coverSub: '', coverHue: 'amber',
  coverAsset: { id: '', url: '' },
  tags: '', publish: true,
};

interface Props {
  heading: string;
  initial: PostFormValues;
  slugReadOnly: boolean;
  showPublishToggle: boolean;
  submitLabel: string;
  submitTestId: string;
  // assetURLs —— editor body 内 standmeet-asset:<id> 引用的预解析 URL map。
  // create 时空（{}），edit 时由 caller 从 AdminPostView.asset_urls 传。
  assetURLs?: Record<string, string>;
  onClose: () => void;
  onSubmit: (s: PostFormSubmit) => Promise<boolean>;
}

export function PostForm(props: Props) {
  const [values, setValues] = useState<PostFormValues>(props.initial);
  const pendingRef = useRef<PendingFile[]>([]);
  const toast = useToast();
  const submit = useSubmitHandler(values, pendingRef, props, toast);
  return (
    <div className="bg-(--color-paper) border border-(--color-rule) max-w-[720px] w-full max-h-[90vh] overflow-y-auto p-7 flex flex-col gap-4">
      <h2 className="font-serif text-[22px]">{props.heading}</h2>
      <PostFormBody values={values} setValues={setValues}
        props={props} toast={toast} pendingRef={pendingRef} />
      <PostFormFooter
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

function PostFormBody({
  values, setValues, props, toast, pendingRef,
}: {
  values: PostFormValues;
  setValues: (v: PostFormValues) => void;
  props: Props;
  toast: ReturnType<typeof useToast>;
  pendingRef: { current: PendingFile[] };
}) {
  const set = <K extends keyof PostFormValues>(k: K, v: PostFormValues[K]) =>
    setValues({ ...values, [k]: v });
  const handlePending = (p: PendingFile) => {
    pendingRef.current = [...pendingRef.current.filter((x) => x.id !== p.id), p];
  };
  return (
    <>
      <PostFieldRow>
        <PostField label="slug" value={values.slug}
          onChange={(v) => set('slug', v)}
          placeholder="url-slug" readOnly={props.slugReadOnly} />
        <PostField label="title" value={values.title}
          onChange={(v) => set('title', v)} placeholder="Post title" />
      </PostFieldRow>
      <PostField label="excerpt" value={values.excerpt}
        onChange={(v) => set('excerpt', v)} placeholder="One-line summary" />
      <PostFieldRow>
        <PostField label="cover headline" value={values.coverHeadline}
          onChange={(v) => set('coverHeadline', v)} placeholder="Big headline" />
        <PostField label="cover sub" value={values.coverSub}
          onChange={(v) => set('coverSub', v)} placeholder="Italic subline" />
      </PostFieldRow>
      <PostFieldRow>
        <CoverHueSelect value={values.coverHue}
          onChange={(v) => set('coverHue', v)} />
        <PostField label="tags" value={values.tags}
          onChange={(v) => set('tags', v)} placeholder="comma, separated" />
      </PostFieldRow>
      <CoverImagePicker value={values.coverAsset}
        onChange={(v) => set('coverAsset', v)}
        onPending={handlePending} toast={toast} />
      <PostBodyField value={values.bodyMD}
        onChange={(v) => set('bodyMD', v)}
        assetURLs={props.assetURLs} onPending={handlePending} />
    </>
  );
}

function useSubmitHandler(
  values: PostFormValues, pendingRef: { current: PendingFile[] },
  props: Props, toast: ReturnType<typeof useToast>,
) {
  return useCallback(async () => {
    await runSubmit(values, pendingRef.current, props, toast);
  }, [values, pendingRef, props, toast]);
}

async function runSubmit(
  values: PostFormValues, files: PendingFile[],
  props: Props, toast: ReturnType<typeof useToast>,
): Promise<void> {
  isValid(values) && await doSubmit(values, files, props, toast);
}

function isValid(v: PostFormValues): boolean {
  return v.slug !== '' && v.title !== '';
}

async function doSubmit(
  values: PostFormValues, files: PendingFile[],
  props: Props, toast: ReturnType<typeof useToast>,
): Promise<void> {
  const ok = await props.onSubmit({ values, files });
  ok && onSubmitSuccess(values, props, toast);
}

function onSubmitSuccess(
  values: PostFormValues, props: Props, toast: ReturnType<typeof useToast>,
): void {
  toast.success(`Post ${values.slug} saved`);
  props.onClose();
}
