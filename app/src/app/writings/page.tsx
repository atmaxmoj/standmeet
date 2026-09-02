// /writings — Stripe-Press-style article index page. SSR fetches the first
// page; infinite scroll fills in later pages client-side. Interaction (tag
// filter / open article / scroll loader) lives in WritingsIndex.

import { fetchWritingsPage } from '@/lib/api/public';
import { WritingsIndex } from '@/components/writings/WritingsIndex';
import { WritingTreeAside } from '@/components/writings/WritingTreeAside';

export const dynamic = 'force-dynamic';

// reader design: 240px writing tree sidebar (reuses LazyTree) + main blog
// index column. reader is the entry page for writings (owner's call) —
// read-only, no chat.
export default async function WritingsIndexPage() {
  const initial = await fetchWritingsPage();
  return (
    <div className="mx-auto max-w-[1180px] px-6 flex gap-12 items-start">
      <div className="hidden lg:block pt-10">
        <WritingTreeAside activeSlug="" />
      </div>
      <div className="min-w-0 flex-1">
        <WritingsIndex
          initialWritings={initial.writings}
          initialCursor={initial.next_cursor}
        />
      </div>
    </div>
  );
}
