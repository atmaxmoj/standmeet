// DeletePageModal — confirm before taking a page down. Deleting is irreversible for a normal page
// and, for the reserved homepage, means "revert / to the built-in default" (the home singleton
// can't be hard-deleted). Both deserve a confirm step rather than firing on a single click.

'use client';

import { useTranslations } from 'next-intl';

import { ModalShell } from '@/components/admin/modals/ModalShell';

interface Props {
  slug: string;
  isHome: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeletePageModal({ slug, isHome, busy, onCancel, onConfirm }: Props) {
  const t = useTranslations('adminPages.microsites.deleteConfirm');
  // One branch, then branch-free JSX: home "delete" means revert-to-default, a normal page is removed.
  const copy = isHome
    ? { title: t('homeTitle'), body: t('homeBody'), confirm: t('homeConfirm') }
    : { title: t('title'), body: t('body', { slug }), confirm: t('confirm') };
  return (
    <ModalShell onClose={onCancel} title={copy.title} maxWidth={460}>
      <div className="px-7 py-6">
        <p className="reading text-[14.5px] text-(--color-muted) mb-6">{copy.body}</p>
        <div className="flex justify-end gap-4 items-baseline">
          <button
            type="button"
            data-testid="microsite-delete-cancel"
            onClick={onCancel}
            className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            data-testid="microsite-delete-confirm"
            onClick={onConfirm}
            disabled={busy}
            className="sm-btn sm-btn-solid sm-btn-sm"
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
