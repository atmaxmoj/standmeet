// ObsidianBar —— WritingsSection 顶部的两个 button：
//   - export to Obsidian: 触发 zip 下载
//   - import from Obsidian: <input type="file" webkitdirectory> 选 vault 目录上传
//
// 实现 1:1 主流 (obsidian-importer + Quartz) 形态：owner 手动 click，
// 没有 watcher / 没有 git。

'use client';

import { useRef } from 'react';

import { webkitDirectoryRef } from '@/lib/admin/webkitdirectory-ref';

import { Btn } from '@/components/admin/atoms/Btn';
import { triggerExport, useObsidianImport, type ImportResult } from '@/lib/admin/use-obsidian';
import { useToast } from '@/lib/ui/toast';

interface Props {
  onImported: () => void;
}

export function ObsidianBar({ onImported }: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onImportDone = () => {
    toast.success('Obsidian vault imported');
    onImported();
  };
  const importer = useObsidianImport(onImportDone);
  return (
    <div className="flex items-baseline gap-3 mb-5" data-testid="obsidian-bar">
      <ExportBtn />
      <ImportBtn
        busy={importer.busy}
        onPick={() => inputRef.current?.click()}
      />
      <HiddenDirInput inputRef={inputRef} onFiles={importer.importVault} />
      <Status busy={importer.busy} result={importer.result} />
    </div>
  );
}

function ExportBtn() {
  return (
    <Btn kind="ghost" onClick={() => triggerExport()}>
      ↓ export to Obsidian
    </Btn>
  );
}

function ImportBtn({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  return (
    <Btn kind="ghost" disabled={busy} onClick={onPick}>
      {busy ? 'importing…' : '↑ import from Obsidian'}
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
  return busy
    ? <span className="mono text-[10px] text-(--color-muted)">working…</span>
    : (result ? <StatusDone result={result} /> : null);
}

function StatusDone({ result }: { result: ImportResult }) {
  return (
    <span
      className="mono text-[10px] text-(--color-muted)"
      data-testid="obsidian-import-result"
    >
      {result.created} new · {result.updated} updated · {result.skipped} skipped
      {result.errors.length > 0 && (
        <span className="text-(--color-accent) ml-2">
          · {result.errors.length} error{result.errors.length === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}
