// BlocksSection —— the plugins group's block view: every block the owner has (built-in +
// installed) and the bundles that group them. This is the block model's own home in the nav,
// separate from `integrations` (external supplier connections): a block is a unit the owner
// composes, a supplier is a third party they connect to. The panels themselves (BlocksPanel,
// BundlePanel) were previously mounted inside SuppliersSection; giving them their own section is
// the design's "plugins nav group, one block [view], one fiber [view]" (the fiber view follows).

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { BlocksPanel } from '@/components/admin/sections/suppliers/BlocksPanel';
import { BundlePanel } from '@/components/admin/sections/suppliers/BundlePanel';

export function BlocksSection() {
  return (
    <>
      <SectionHeader slug="blocks" />
      <div className="mb-8">
        <BlocksPanel />
      </div>
      {/* Install and assemble: the owner adds a block and groups blocks into bundles. */}
      <div className="mb-8">
        <BundlePanel />
      </div>
    </>
  );
}
