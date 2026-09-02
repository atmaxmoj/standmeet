// TagFilterRow —— the row of tag chips at the top of the corpus admin.
//
// Split out of WikiSection to stay under max-lines. The tag row pulls tags for
// the **whole genre** (`useGenreTags`), not just the currently loaded page —
// the latter would leave tags that only exist outside that page without a chip
// at all, unclickable and undiscoverable (the second half of F-L-23).

'use client';

import { useTranslations } from 'next-intl';

import { Chip } from '@/components/admin/atoms/Chip';

export function TagFilterRow({
  tags, activeTag, setActiveTag,
}: {
  tags: readonly string[];
  activeTag: string | null;
  setActiveTag: (t: string | null) => void;
}) {
  const msg = useTranslations('adminCorpus.wiki');
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap" data-testid="wiki-tag-filter">
      <Chip active={activeTag === null} onClick={() => setActiveTag(null)}>{msg('all')}</Chip>
      {tags.map((t) => (
        <Chip key={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? null : t)}>
          {t}
        </Chip>
      ))}
    </div>
  );
}
