// vault-import-state.ts —— derives the "last import" line on /admin/obsidian from the data (UX-62).
//
// Follows `source-state.ts`'s approach rather than inventing a new one: two
// sibling pages are saying the same kind of thing — "when did this last
// happen, and how did it go" — so they should sound the same
// ([[vocabulary-must-not-diverge]]).
//
// **Two states, not one**:
//   · never imported → `never imported`
//   · imported        → `last import · <date> · 31 new · 20 updated`
//
// "never imported" and "imported but zero changes" must stay distinguishable,
// so the sentinel is the server-supplied `never`, not a count of 0.
// The derivation lives here, not in the component: the presentation layer doesn't write if.

import { z } from 'zod';

export const VaultImportStateSchema = z.object({
  last_import_at: z.string().default(''),
  new: z.number().default(0),
  updated: z.number().default(0),
  skipped: z.number().default(0),
  // deleted —— how many were pruned that time (F-L-62). It's not the same
  // kind of number as the other three: new/updated/unchanged are all
  // reversible, pruning isn't — and this line used to only report the three reversible ones.
  deleted: z.number().default(0),
  never: z.boolean(),
});

export type VaultImportState = z.infer<typeof VaultImportStateSchema>;

export function vaultImportLine(s: VaultImportState | null): string {
  if (s === null) return '';
  return s.never
    ? 'never imported'
    : `last import · ${s.last_import_at.slice(0, 10)} · ${changeSummary(s)}`;
}

// changeSummary —— what actually changed that time. **skipped is stated
// too**: an import where "nothing changed" and an import that never
// happened must be distinguishable to the owner.
//
// **deleted is always stated, even when it's 0** (F-L-62): pruning is the
// only irreversible one of these four numbers. Zero is a statement too —
// "nothing pruned this time" and "this version doesn't report pruning at
// all" must be distinguishable to the owner, and the latter is exactly what that defect looked like.
function changeSummary(s: VaultImportState): string {
  return `${s.new} new · ${s.updated} updated · ${s.deleted} deleted · ${s.skipped} unchanged`;
}
