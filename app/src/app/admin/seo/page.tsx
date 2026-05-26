import { AdminShell } from '@/components/admin/AdminShell';
import { StubSection } from '@/components/admin/sections/StubSection';

export default function AdminSEOPage() {
  return (
    <AdminShell active="seo">
      <StubSection
        kicker="settings · seo"
        title="seo & feeds"
        intent="Robots.txt extras, sitemap extras, OG template defaults. Per-wiki SEO slug + description + indexed flag still lives inline on the wiki entry."
        mcpHint="`seo.update_settings` from Claude."
      />
    </AdminShell>
  );
}
