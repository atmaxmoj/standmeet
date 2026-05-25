// CoverImagePicker —— admin posts 表单的 cover image 上传 row：
// preview thumbnail + file picker + clear 按钮。
//
// 走跟 body 图片同一个 uploadAsset()；返 {id, presigned_url}，id 进
// cover_image_asset_id 提交到 backend，url 给 preview 用。

import Image from 'next/image';

import type { useToast } from '@/lib/ui/toast';
import { uploadAsset } from '@/lib/blog/upload-asset';

export interface CoverAssetState { id: string; url: string }

interface Props {
  value: CoverAssetState;
  onChange: (v: CoverAssetState) => void;
  toast: ReturnType<typeof useToast>;
}

export function CoverImagePicker({ value, onChange, toast }: Props) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        cover image (optional)
      </span>
      <Row value={value} onChange={onChange} toast={toast} />
    </label>
  );
}

function Row({ value, onChange, toast }: Props) {
  return (
    <div className="flex items-center gap-3">
      <Preview url={value.url} />
      <PickerInput
        onPicked={onChange}
        onError={(msg) => toast.error(msg)}
      />
      <ClearMaybe value={value} onChange={onChange} />
    </div>
  );
}

function Preview({ url }: { url: string }) {
  return url ? <PreviewImg url={url} /> : <PreviewEmpty />;
}

function PreviewImg({ url }: { url: string }) {
  return (
    <Image
      src={url}
      alt="cover preview"
      width={80}
      height={48}
      unoptimized
      style={{ objectFit: 'cover', border: '1px solid var(--color-rule)' }}
    />
  );
}

function PreviewEmpty() {
  return (
    <div className="w-20 h-12 border border-(--color-rule) flex items-center justify-center mono text-[9px] text-(--color-faint) uppercase">
      no img
    </div>
  );
}

function PickerInput({
  onPicked, onError,
}: { onPicked: (v: CoverAssetState) => void; onError: (msg: string) => void }) {
  return (
    <input
      type="file"
      accept="image/*"
      data-testid="post-field-cover-image"
      onChange={(e) => void handlePick(e.target.files, onPicked, onError)}
      className="mono text-[11px]"
    />
  );
}

async function handlePick(
  files: FileList | null,
  onPicked: (v: CoverAssetState) => void,
  onError: (msg: string) => void,
): Promise<void> {
  const file = firstFile(files);
  await (file ? doUploadCover(file, onPicked, onError) : Promise.resolve());
}

function firstFile(files: FileList | null): File | null {
  return files?.[0] ?? null;
}

async function doUploadCover(
  file: File,
  onPicked: (v: CoverAssetState) => void,
  onError: (msg: string) => void,
): Promise<void> {
  try {
    const a = await uploadAsset(file);
    onPicked({ id: a.id, url: a.url });
  } catch (err) {
    onError(err instanceof Error ? err.message : 'upload failed');
  }
}

function ClearMaybe({
  value, onChange,
}: { value: CoverAssetState; onChange: (v: CoverAssetState) => void }) {
  return value.id ? <ClearBtn onChange={onChange} /> : null;
}

function ClearBtn({ onChange }: { onChange: (v: CoverAssetState) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange({ id: '', url: '' })}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      clear
    </button>
  );
}
