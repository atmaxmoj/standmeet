// CoverImagePicker —— the cover image selection row in the admin writings form:
// preview thumbnail + file picker + clear.
//
// No immediate upload: file pick → assign a pending-id + objectURL (local preview) →
// report cover_image_ref = 'pending-<id>' via onChange, and also report the
// PendingFile to WritingForm via onPending (bundled into the multipart save).
// Edit mode: the caller passes in the id + presigned URL of an already-stored
// asset (the value field) and never touches onPending.

'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';

import { FilePicker } from '@/components/admin/atoms/FilePicker';
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
  const t = useTranslations('adminCorpus.writings');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('coverImage')}
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
  const t = useTranslations('adminCorpus.writings');
  return (
    <div className="w-20 h-12 border border-(--color-rule) flex items-center justify-center mono text-[9px] text-(--color-faint) uppercase">
      {t('noImg')}
    </div>
  );
}

interface PickerInputProps {
  onPicked: (v: CoverAssetState) => void;
  onPending: (p: PendingFile) => void;
  onError: (msg: string) => void;
}

function PickerInput({ onPicked, onPending, onError }: PickerInputProps) {
  const t = useTranslations('adminCorpus.writings');
  return (
    <FilePicker
      label={t('chooseCover')}
      testid="writing-field-cover-image"
      accept="image/*"
      onPick={(files) => handlePick(files, onPicked, onPending, onError)}
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
  const t = useTranslations('adminCorpus.writings');
  return (
    <button
      type="button"
      onClick={() => onChange({ id: '', url: '' })}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('clear')}
    </button>
  );
}
