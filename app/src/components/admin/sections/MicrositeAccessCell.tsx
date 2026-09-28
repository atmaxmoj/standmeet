// MicrositeAccessCell —— the pages table's "access" column: who may open a page. The "open
// without an access code" switch, then bring-your-own-key. Each switch carries its meaning as
// visible text beside it, not only in a tooltip.

'use client';

import { useTranslations } from 'next-intl';

import { Toggle } from '@/components/atoms/Toggle';
import { useMicrosites, type MicrositeSummary } from '@/lib/admin/use-microsites';
import { useAction } from '@/lib/ui/use-action';

export function AccessCell({ page }: { page: MicrositeSummary }) {
  return (
    <td className="px-4 py-3 mono text-[10px]">
      <OpenWithoutCodeSwitch page={page} />
      <ByoaiToggle page={page} />
    </td>
  );
}

function OpenWithoutCodeSwitch({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.microsites');
  const { setOpenWithoutCode } = useMicrosites();
  const run = useAction();
  const open = page.open_without_code === true;
  return (
    <label className="flex items-center gap-2 text-(--color-ink)">
      <Toggle
        on={open}
        testid={`microsite-without-code-${page.slug}`}
        label={t('openWithoutCode')}
        onToggle={() => void run(() => setOpenWithoutCode(page.slug, !open), {
          success: t(open ? 'openToastOff' : 'openToastOn', { slug: page.slug }),
        })}
      />
      <span aria-hidden>{t('openWithoutCode')}</span>
    </label>
  );
}

// ByoaiToggle —— whether this page allows visitors to bring their own key.
//
// **Voided the moment a code is attached**: the code decides admission, this page's
// own toggle no longer has the final say ("pages give a code a rendering"). So when
// a code is attached, the control isn't hidden — it plainly states it's been
// overridden; hiding it would let the owner think their last setting still applies.
function ByoaiToggle({ page }: { page: MicrositeSummary }) {
  const bound = (page.bound_codes ?? []).length > 0;
  return bound ? <ByoaiVoid slug={page.slug} /> : <ByoaiButton page={page} />;
}

function ByoaiVoid({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.microsites');
  return (
    <div className="text-(--color-faint) mt-1" data-testid={`microsite-byoai-void-${slug}`}>
      {t('byoaiVoid')}
    </div>
  );
}

// An iOS-style toggle switch (track + sliding knob), not a text pill: the owner asked for "那种能点
// 的 iPhone 的" switch. Its accessible name (and the on/off state for tests) is the byoaiOn/byoaiOff
// string, shown beside it too.
function ByoaiButton({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.microsites');
  const { setByoai } = useMicrosites();
  const run = useAction();
  const allow = page.allow_byoai === true;
  return (
    <label className="flex items-center gap-2 mt-1.5 text-(--color-muted)">
      <Toggle
        on={allow}
        testid={`microsite-byoai-${page.slug}`}
        label={allow ? t('byoaiOn') : t('byoaiOff')}
        onToggle={() => void run(() => setByoai(page.slug, !allow), {
          success: t(allow ? 'byoaiToastOff' : 'byoaiToastOn', { slug: page.slug }),
        })}
      />
      <span aria-hidden>{allow ? t('byoaiOn') : t('byoaiOff')}</span>
    </label>
  );
}
