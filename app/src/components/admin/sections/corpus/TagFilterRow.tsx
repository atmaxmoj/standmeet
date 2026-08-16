// TagFilterRow —— 语料后台顶上那排标签 chip。
//
// 从 WikiSection 拆出来守 max-lines。标签行取的是**整个 genre** 的标签（`useGenreTags`），
// 不是已加载的那一页 —— 后者会让只存在于那一页之外的标签连 chip 都没有，
// 于是点不到、也无从发现自己漏了什么（F-L-23 的后半条）。

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
