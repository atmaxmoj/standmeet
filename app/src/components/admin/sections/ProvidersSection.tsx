// ProvidersSection —— /admin/providers. The owner's provider book on its own nav entry: every
// provider a turn can be sent to, which one is the default (used when neither the access code nor
// the role names another), and — for a metered/free provider — its token budget + auto-refill
// schedule. Moved out of api-mcp so provider settings have their own home. The default-entry form
// (AIProviderPanel) sits above the book: both write the same provider table, so this page is its
// only home — it used to linger on api·mcp as a second one.

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { AIProviderPanel } from '@/components/admin/sections/api/AIProviderPanel';
import { ProviderBookPanel } from '@/components/admin/sections/api/ProviderBookPanel';

export function ProvidersSection() {
  return (
    <>
      <SectionHeader slug="providers" />
      <div className="space-y-10">
        <AIProviderPanel />
        <ProviderBookPanel />
      </div>
    </>
  );
}
