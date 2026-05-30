// CoverImagePicker —— admin writings 表单的 cover image 选择 row：
// preview thumbnail + file picker + clear。
//
// 不立即上传：file pick → 分配 pending-id + objectURL（本地预览）→
// 通过 onChange 报 cover_image_ref = 'pending-<id>'，同时 onPending
// 报 PendingFile 给 WritingForm（save 时一起 multipart）。
// edit 模式：caller 把已存 asset 的 id + presigned URL 传进来 (value 字段)，
// 不动 onPending。

import Image from 'next/image';

import type { useToast } from '@/lib/ui/toast';
import { newPendingID, type PendingFile } from '@/lib/writings/upload-asset';

export interface CoverAssetState { id: string; url: string }

interface Props {
  value: CoverAssetState;
  onChange: (v: CoverAssetState) => void;
  onPending: (p: PendingFile) => void;
  toast: ReturnType<typeof useToast>;
}

export function CoverImagePicker({ value, onChange, onPending, toast }: Props) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        cover image (optional)
      </span>
      <Row value={value} onChange={onChange} onPending={onPending} toast={toast} />
    </label>
  );
}

function Row({ value, onChange, onPending, toast }: Props) {
  return (
    <div className="flex items-center gap-3">
      <Preview url={value.url} />
      <PickerInput
        onPicked={onChange}
        onPending={onPending}
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
      className="object-cover border border-(--color-rule)"
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

interface PickerInputProps {
  onPicked: (v: CoverAssetState) => void;
  onPending: (p: PendingFile) => void;
  onError: (msg: string) => void;
}

function PickerInput({ onPicked, onPending, onError }: PickerInputProps) {
  return (
    <input
      type="file"
      accept="image/*"
      data-testid="writing-field-cover-image"
      onChange={(e) => handlePick(e.target.files, onPicked, onPending, onError)}
      className="mono text-[11px]"
    />
  );
}

function handlePick(
  files: FileList | null,
  onPicked: (v: CoverAssetState) => void,
  onPending: (p: PendingFile) => void,
  onError: (msg: string) => void,
): void {
  const file = firstFile(files);
  file ? attachPending(file, onPicked, onPending) : onError('no file selected');
}

function firstFile(files: FileList | null): File | null {
  return files?.[0] ?? null;
}

function attachPending(
  file: File,
  onPicked: (v: CoverAssetState) => void,
  onPending: (p: PendingFile) => void,
): void {
  const id = newPendingID();
  const objectURL = URL.createObjectURL(file);
  onPending({ id, file, objectURL });
  onPicked({ id, url: objectURL });
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
