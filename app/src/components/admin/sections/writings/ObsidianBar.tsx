// ObsidianBar —— the two buttons at the top of WritingsSection:
//   - export to Obsidian: triggers a zip download
//   - import from Obsidian: <input type="file" webkitdirectory> picks a vault
//     directory to upload
//
// Mirrors the mainstream shape 1:1 (obsidian-importer + Quartz): owner clicks
// manually, no watcher, no git.

'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import { webkitDirectoryRef } from '@/lib/admin/webkitdirectory-ref';

import { Btn } from '@/components/admin/atoms/Btn';
import { triggerExport, useObsidianImport, type ImportResult } from '@/lib/admin/use-obsidian';
import { useToast } from '@/lib/ui/toast';
import { useReportError } from '@/lib/ui/use-report-error';

interface Props {
  onImported: () => void;
}

export function ObsidianBar({ onImported }: Props) {
  const toast = useToast();
  const report = useReportError();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onImportDone = () => {
    toast.success('Obsidian vault imported');
    onImported();
  };
  const importer = useObsidianImport(onImportDone);
  // On import failure, don't just quietly reset the spinner — surface it via
  // report (uploadVault now propagates the rejection upward).
  const onFiles = (files: FileList) => importer.importVault(files).catch(report);
  return (
    // import comes first, solid; export comes after, ghost. The two actions have
    // **asymmetric consequences**: import upserts the corpus (and, per this round's
    // vault-sync, can also delete), export just downloads a zip. They used to be two
    // text links at the same size and grayscale, with no way to tell which one
    // changes anything (UX-63).
    <div className="flex items-baseline gap-3 mb-5" data-testid="obsidian-bar">
      <ImportBtn
        busy={importer.busy}
        onPick={() => inputRef.current?.click()}
      />
      <ExportBtn />
      <HiddenDirInput inputRef={inputRef} onFiles={onFiles} />
      <Status busy={importer.busy} result={importer.result} />
    </div>
  );
}

function ExportBtn() {
  const t = useTranslations('adminCorpus.obsidianBar');
  return (
    <Btn kind="ghost" onClick={() => triggerExport()}>
      {t('export')}
    </Btn>
  );
}

function ImportBtn({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  const t = useTranslations('adminCorpus.obsidianBar');
  return (
    <Btn kind="solid" disabled={busy} onClick={onPick}>
      {busy ? t('importing') : t('import')}
    </Btn>
  );
}

function HiddenDirInput({
  inputRef, onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (f: FileList) => Promise<void>;
}) {
  return (
    <input
      ref={webkitDirectoryRef(inputRef)}
      type="file"
      multiple
      data-testid="obsidian-vault-input"
      className="hidden"
      onChange={(e) => handlePick(e.target.files, onFiles)}
    />
  );
}

function handlePick(files: FileList | null, onFiles: (f: FileList) => Promise<void>) {
  files && files.length > 0 && void onFiles(files);
}

function Status({ busy, result }: { busy: boolean; result: ImportResult | null }) {
  const t = useTranslations('adminCorpus.obsidianBar');
  return busy
    ? <span className="mono text-[10px] text-(--color-muted)">{t('working')}</span>
    : (result ? <StatusDone result={result} /> : null);
}

function StatusDone({ result }: { result: ImportResult }) {
  const t = useTranslations('adminCorpus.obsidianBar');
  return (
    <span
      className="mono text-[10px] text-(--color-muted)"
      data-testid="obsidian-import-result"
    >
      {/* Report deleted too, even when 0: of the four counts, it's the only irreversible one (F-L-62). */}
      {t('result', {
        created: result.created, updated: result.updated,
        deleted: result.deleted, skipped: result.skipped,
      })}
      {result.errors.length > 0 && (
        <span className="text-(--color-accent) ml-2">
          {t('errors', { count: result.errors.length })}
        </span>
      )}
    </span>
  );
}
