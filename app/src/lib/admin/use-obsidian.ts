// use-obsidian.ts —— the admin hook for two-way Obsidian vault sync.
//
// export: GET /api/admin/obsidian/export → application/zip. The browser
//   triggers the download via anchor[download].
// import: POST /api/admin/obsidian/import multipart, each file field is
//   named in the format 'file:<index>', FileHeader.filename =
//   webkitRelativePath (the path counted from the vault root). response = { created, updated, skipped, errors }.

import { useEffect, useState } from 'react';

import { VaultImportStateSchema, type VaultImportState } from '@/lib/admin/vault-import-state';

const CSRF_COOKIE = 'csrftoken';

function readCSRFCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match?.slice(CSRF_COOKIE.length + 1) ?? '';
}

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

const ImportResultSchema = z.object({
  created: z.number(), updated: z.number(), skipped: z.number(), errors: z.array(z.string()),
  // deleted —— notes pruned because they are gone from the vault (authoritative sync, F-L-6).
  deleted: z.number().optional().default(0),
});
export type ImportResult = z.infer<typeof ImportResultSchema>;

// triggerExport —— triggers directly via anchor[download]; doesn't go
// through fetch + blob, so a large vault's zip is never read entirely into memory.
export function triggerExport(): void {
  if (typeof window === 'undefined') return;
  const a = document.createElement('a');
  a.href = '/api/admin/obsidian/export';
  a.download = 'standmeet-vault.zip';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// uploadVault —— the owner selects the entire vault directory through
// <input type="file" webkitdirectory>; the browser hands back a set of
// Files, each File.webkitRelativePath being the path relative to inside the
// vault (with the vault name as a prefix). This assembles the multipart upload.
export async function uploadVault(files: FileList): Promise<ImportResult> {
  const fd = new FormData();
  for (const f of syncableVaultFiles(files)) {
    // The path relative to inside the vault goes into the form field name
    // (the server reconstructs the directory from the field name): Go
    // multipart runs filepath.Base on the filename's directory (path
    // traversal protection), so the path can't survive there — it can only be carried through the field name.
    const rel = relPathOf(f);
    fd.append(rel, f, rel);
  }
  // The directory picker hands us the WHOLE vault, so this upload is authoritative: notes the owner
  // deleted from the vault get pruned and the corpus converges on it, instead of only ever growing
  // (F-L-6). Opt-in — the server treats an unflagged upload as a partial feed and never deletes.
  fd.append('authoritative', 'true');
  const headers: Record<string, string> = {};
  const csrf = readCSRFCookie();
  csrf && (headers['X-Csrftoken'] = csrf);
  const res = await fetch('/api/admin/obsidian/import', {
    method: 'POST', headers, body: fd, credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await importErrorMessage(res));
  }
  return safeJson(res, ImportResultSchema);
}

// importErrorMessage —— a human sentence, never `import failed: 400`. The owner is not debugging
// HTTP: a raw status code tells them nothing about what to do (project rule: no exit codes / no
// technical jargon at the UI). Prefer the backend envelope's own message, else say something true
// and actionable about the size case, which is the one an owner can actually hit.
async function importErrorMessage(res: Response): Promise<string> {
  const detail = await res.json().then(
    (b: unknown) => readEnvelopeMessage(b),
    () => '',
  );
  if (res.status === 413 || /too large/i.test(detail)) {
    return 'That vault was too large to upload in one go. Try importing a smaller vault folder.';
  }
  return detail !== ''
    ? `Couldn't import the vault: ${detail}`
    : "Couldn't import the vault. Please try again.";
}

// ErrorEnvelopeSchema —— the backend's apierr envelope shape, parsed (not asserted) so a body in
// any other shape degrades to "" and the caller falls back to a generic sentence.
const ErrorEnvelopeSchema = z.object({
  error: z.object({ message: z.string() }).partial().optional(),
});

function readEnvelopeMessage(body: unknown): string {
  const parsed = ErrorEnvelopeSchema.safeParse(body);
  return parsed.success ? (parsed.data.error?.message ?? '') : '';
}

function relPathOf(f: File): string {
  if ('webkitRelativePath' in f && typeof f.webkitRelativePath === 'string' && f.webkitRelativePath !== '') {
    return f.webkitRelativePath;
  }
  return f.name;
}

// OBSIDIAN_CSS_KEEP —— the only dot-path files the sync actually consumes: the owner's theme config
// and CSS snippets, which ARE harvested (see sync_classify.go isObsidianCSS). Everything else under
// a dot-directory is dropped by the server on arrival.
const OBSIDIAN_APPEARANCE = '.obsidian/appearance.json';
const OBSIDIAN_SNIPPETS = '.obsidian/snippets/';

function isHarvestedObsidianConfig(rel: string): boolean {
  return rel.endsWith(OBSIDIAN_APPEARANCE)
    || (rel.includes(OBSIDIAN_SNIPPETS) && rel.endsWith('.css'));
}

// isHiddenVaultPath —— mirrors the server's isHiddenPath: any dot-segment (or _templates) is not
// vault content. A real Obsidian vault is very often a GIT REPO, so this is what keeps `.git`'s
// thousands of objects out of the upload.
function isHiddenVaultPath(rel: string): boolean {
  return rel.split('/').some((seg) => seg === '_templates' || seg.startsWith('.'));
}

// syncableVaultFiles —— send only what the server will actually consume, mirroring its own filter
// (sync_classify.go: non-hidden .md under a genre folder, writing attachments, and the harvested
// .obsidian CSS config).
//
// The directory picker hands us the WHOLE folder, and a real vault is usually version-controlled:
// uploading it verbatim posted ~3.5k `.git` objects the server drops on arrival, which blew the
// multipart part limit and made importing a git-backed vault fail outright with "message too large"
// (F-L-7). Filtering here is not an optimisation — it is what makes a real vault importable.
export function syncableVaultFiles(files: FileList): File[] {
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f) continue;
    const rel = relPathOf(f);
    if (isHarvestedObsidianConfig(rel) || !isHiddenVaultPath(rel)) out.push(f);
  }
  return out;
}

// useObsidianImport —— for the UI: the batch upload triggered by the picker, loading + result display.
// useVaultImportState —— "when was the last import" (UX-62). **Refetched
// every time this page is entered**: the standard is "it can still answer
// after a refresh", so it has to come from a server-side fact, not the residual warmth of the last click.
export function useVaultImportState(reloadKey: number): VaultImportState | null {
  const [state, setState] = useState<VaultImportState | null>(null);
  useEffect(() => {
    let live = true;
    // Uses schema parsing, not a type assertion: the day the server narrows
    // the shape, this must **go red**, not silently turn into an object with no readable fields ([[zod-unknown-is-not-optional]]).
    void fetch('/api/admin/obsidian/state', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: unknown) => { if (live) setState(VaultImportStateSchema.nullable().parse(v)); })
      .catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [reloadKey]);
  return state;
}

export function useObsidianImport(onDone: () => void): {
  busy: boolean;
  result: ImportResult | null;
  importVault: (files: FileList) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const importVault = async (files: FileList) => {
    setBusy(true);
    try {
      const r = await uploadVault(files);
      setResult(r);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, importVault };
}
