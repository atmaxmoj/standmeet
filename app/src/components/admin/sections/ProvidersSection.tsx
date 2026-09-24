// ProvidersSection —— /admin/providers. The owner's provider book on its own nav entry: every
// provider a turn can be sent to, which one is the default (used when neither the access code nor
// the role names another), and — for a metered/free provider — its token budget + auto-refill
// schedule. Moved out of api-mcp so provider settings have their own home.

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ProviderBookPanel } from '@/components/admin/sections/api/ProviderBookPanel';

export function ProvidersSection() {
  return (
    <>
      <SectionHeader slug="providers" />
      <div className="space-y-10">
        <ProviderBookPanel />
      </div>
    </>
  );
}
