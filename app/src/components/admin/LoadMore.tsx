// LoadMore —— the foot of every paged admin list (docs/design/paging.md). A sentinel loads the
// next page when it scrolls into view; the button does the same for keyboard users and for when
// the observer never fires. Nothing renders once the last page is in.

'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import { resolveBtnClass } from '@/lib/admin/btn-styles';
import { useLoadMoreOnView } from '@/lib/state/create-paged-store';

export function LoadMore({ page, testid }: {
  page: { hasMore: boolean; loadingMore: boolean; loadMore: () => Promise<void> };
  testid: string;
}) {
  const t = useTranslations('adminShell.listPane');
  const ref = useRef<HTMLDivElement | null>(null);
  const { hasMore, loadingMore, loadMore } = page;
  useLoadMoreOnView(ref, page);
  return hasMore ? (
    <div ref={ref} className="mt-6 flex justify-center">
      <button
        type="button" data-testid={testid} disabled={loadingMore}
        onClick={() => void loadMore()} className={resolveBtnClass()}
      >
        {loadingMore ? t('loadingMore') : t('loadMore')}
      </button>
    </div>
  ) : null;
}
