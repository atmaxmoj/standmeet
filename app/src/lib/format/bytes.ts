// bytes.ts — turns a byte count into a human-readable size.
//
// Lives in the neutral lib/format instead of lib/admin or lib/visitor: the asset row
// in the admin panel and the download area on the visitor page describe **the same
// thing** (how big this file is). Writing it twice would eventually drift out of
// sync at some boundary — and a difference like "1023 B shown as 1023 B in one place
// and 1.0 KB in the other" is not the kind of thing anyone reports.

/** formatBytes — 1023 B / 4.8 KB / 3.4 MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
