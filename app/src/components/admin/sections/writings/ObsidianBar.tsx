// ObsidianBar —— WritingsSection 顶部的两个 button：
//   - export to Obsidian: 触发 zip 下载
//   - import from Obsidian: <input type="file" webkitdirectory> 选 vault 目录上传
//
// 实现 1:1 主流 (obsidian-importer + Quartz) 形态：owner 手动 click，
// 没有 watcher / 没有 git。

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
  // 导入失败别只是悄悄复位 spinner —— report 反显（uploadVault 现在把 rejection 传上来）。
  const onFiles = (files: FileList) => importer.importVault(files).catch(report);
  return (
    // import 在前、实心；export 在后、ghost。两个动作**后果不对称**：import 会 upsert 语料
    // （本轮 vault-sync 记着它还能删），export 只是下载一个 zip。它们原来是两段同字号同灰度的
    // 文字链接，看不出哪个会改东西（UX-63）。
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
      {/* deleted 也报，哪怕是 0：四个数里只有它不可逆（F-L-62）。 */}
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
