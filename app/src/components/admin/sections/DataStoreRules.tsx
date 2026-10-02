// DataStoreRules —— a page store's rules on /admin/data: whether a new entry waits for the owner's
// review, how many entries the page may hold, and, per waiting entry, the approve action
// (S2, docs/design/scenario-s2-collaborative-writing.md). Default: no review, 500 entries.

'use client';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { Toggle } from '@/components/atoms/Toggle';
import type { MicrositeStoreHook, StoreDoc, StorePolicy } from '@/lib/admin/use-microsite-store';
import { useAction } from '@/lib/ui/use-action';

export function StoreRules({ slug, store }: { slug: string; store: MicrositeStoreHook }) {
  return store.policy === null ? null : <Rules slug={slug} store={store} policy={store.policy} />;
}

function Rules({ slug, store, policy }: {
  slug: string; store: MicrositeStoreHook; policy: StorePolicy;
}) {
  const t = useTranslations('adminPages.data');
  const run = useAction();
  return (
    <div className="sm-store-rules">
      <label>
        <Toggle
          on={policy.review}
          testid={`data-review-${slug}`}
          label={t('review')}
          onToggle={() => void run(() => store.setPolicy({ review: !policy.review }),
            { success: t('policySaved') })}
        />
        <span aria-hidden>{t('review')}</span>
      </label>
      <LimitField slug={slug} store={store} max={policy.max_docs} />
    </div>
  );
}

function LimitField({ slug, store, max }: { slug: string; store: MicrositeStoreHook; max: number }) {
  const t = useTranslations('adminPages.data');
  const run = useAction();
  const [value, setValue] = useState(String(max));
  useEffect(() => { setValue(String(max)); }, [max]);
  const n = Number(value);
  return (
    <label>
      <span>{t('limit')}</span>
      <input
        type="number" min={1} value={value} aria-label={t('limit')}
        data-testid={`data-limit-${slug}`}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button" className="sm-btn sm-btn-outline sm-btn-sm"
        data-testid={`data-limit-save-${slug}`}
        disabled={!Number.isInteger(n) || n < 1 || n === max}
        onClick={() => void run(() => store.setPolicy({ max_docs: n }), { success: t('policySaved') })}
      >
        {t('limitSave')}
      </button>
    </label>
  );
}

// PendingMark —— shown on an entry that waits for review.
export function PendingMark() {
  const t = useTranslations('adminPages.data');
  return <span className="sm-pending-tag" data-testid="data-doc-pending">{t('pending')}</span>;
}

// ApproveButton —— publish one waiting entry.
export function ApproveButton({ doc, store }: { doc: StoreDoc; store: MicrositeStoreHook }) {
  const t = useTranslations('adminPages.data');
  const run = useAction();
  return (
    <button
      type="button" className="sm-btn sm-btn-outline sm-btn-sm"
      data-testid={`data-doc-approve-${doc.id}`}
      onClick={() => void run(() => store.approveDoc(doc.collection, doc.id).then(store.reload),
        { success: t('approved') })}
    >
      {t('approve')}
    </button>
  );
}
