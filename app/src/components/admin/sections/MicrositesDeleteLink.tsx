// MicrositesDeleteLink — the "delete" action on a microsite row / the homepage card. Opens a confirm
// modal first. For the reserved homepage (isHome), "delete" can't hard-remove the singleton served
// at `/`; the confirmed action unpublishes it (clears live) so `/` reverts to the built-in
// DefaultHome, keeping the draft. Any other page soft-deletes. Extracted to its own file to keep
// MicrositesSection under the line cap.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { DeletePageModal } from '@/components/admin/modals/DeletePageModal';
import { useMicrosites } from '@/lib/admin/use-microsites';
import { useAction } from '@/lib/ui/use-action';

export function DeleteLink({ slug, isHome }: { slug: string; isHome: boolean }) {
  const t = useTranslations('adminPages.microsites');
  const { removePage, unpublish } = useMicrosites();
  const run = useAction();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = () => void run(
    async () => {
      setBusy(true);
      try {
        await (isHome ? unpublish(slug) : removePage(slug));
        setOpen(false);
      } finally {
        setBusy(false);
      }
    },
    { success: isHome ? t('homeReverted') : t('deleted', { slug }) },
  );
  return (
    <>
      <button
        type="button"
        data-testid={`microsite-delete-${slug}`}
        className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
        onClick={() => setOpen(true)}
      >
        {t('delete')}
      </button>
      {open && (
        <DeletePageModal
          slug={slug} isHome={isHome} busy={busy}
          onCancel={() => setOpen(false)} onConfirm={confirm}
        />
      )}
    </>
  );
}
