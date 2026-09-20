// CodeBlockList — the answer to "what can this code do", read rather than simulated.
//
// `docs/design/plugin/frontend.md` §3. Today that question needs
// `global ∧ role ∧ ¬code-deny` evaluated across three screens, which is why it takes a
// design document and a matrix of specs to explain. A code bound to a bundle has an
// answer that is just a list, and this renders that list.
//
// Two things are shown per entry, and keeping them apart is the point:
//
//	IN THE LIST      the bundle grants it. Absent means absent — undiscoverable, not
//	                 present-and-off.
//	off / disabled   the owner's live kill switch, which is a different question.
//
// **Read-only on purpose.** There is no per-code "deny this block" switch here: for a
// bundle-bound code the bundle IS the grant (`mounted_gate.go` `granted()` — the additive
// model and the role's per-code denials stand side by side and do NOT merge), so a
// code-tier block denial has no effect on a bundle. To take a block off a bundle-bound
// code, edit the group (or point the code at a different one). Per-code block denial is a
// role-based-code capability; see `blocks-admin-coverage.md` G2.

'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useBlocks } from '@/lib/admin/use-blocks';
import { useBundles } from '@/lib/admin/use-bundles';

export function CodeBlockList({ bundle }: { bundle: string }) {
  const t = useTranslations('adminIntegrations.blocks');
  const { bundles, ensureLoaded } = useBundles();
  const blockRows = useBlocks();
  const blocksLoad = blockRows.ensureLoaded;
  useEffect(() => {
    void ensureLoaded();
    void blocksLoad();
  }, [ensureLoaded, blocksLoad]);

  const found = bundles.find((b) => b.name === bundle);
  const blocks = found?.blocks ?? [];
  return (
    <ul className="mt-2 space-y-1" data-testid="code-block-list">
      {blocks.map((id) => (
        <li
          key={id}
          data-testid={`code-block-${id}`}
          className="mono text-[10px] text-(--color-muted)"
        >
          <span className="text-(--color-ink)">{id}</span>
          {isOff(blockRows.rows, id) && (
            <span className="ml-1 text-(--color-accent)">{t('blockOff')}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// isOff — the owner turned this block off instance-wide.
//
// Read from the block rows rather than from the bundle: enablement is a property of
// the block on this instance, not of its membership in one group. A block switched off
// is off in every bundle that holds it, and reading it per bundle would let two lists
// disagree about the same switch.
function isOff(rows: readonly { id: string; enabled: boolean }[], id: string): boolean {
  const row = rows.find((r) => r.id === id);
  return row !== undefined && !row.enabled;
}
