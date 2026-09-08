// FaviconEditor — pick the site favicon from an uploaded image asset, or reset to the default.
// The live <img src="/favicon.ico"> shows what's currently served; the select is an action (choosing
// an image PUTs it, "Default" clears it back to the product favicon). No per-asset thumbnail: assets
// have no ready preview URL, so images are listed by filename.

'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';

import { adminAPI } from '@/lib/api/admin';
import { useAssets, isImage } from '@/lib/admin/use-assets';
import { useAction } from '@/lib/ui/use-action';
import { SelectField } from '@/components/atoms/SelectField';

const CHOOSE = '__choose__'; // the inert placeholder option

export function FaviconEditor() {
  const t = useTranslations('adminShell.account');
  const { assets } = useAssets();
  const run = useAction();
  const [bust, setBust] = useState(() => Date.now()); // cache-buster to refresh the preview after a set
  const [sel, setSel] = useState(CHOOSE);
  const images = assets.filter(isImage);

  // The placeholder option is inert; any real choice (an asset id, or '' = default) is applied.
  const apply = (value: string): void => {
    setSel(value);
    void run(
      () => adminAPI.putVoid('/appearance/favicon', { asset_id: value }).then(() => setBust(Date.now())),
      { success: t('faviconSaved') },
    );
  };
  const onChange = (value: string): void => { value !== CHOOSE && apply(value); };

  return (
    <div data-testid="favicon-editor">
      <div className="sm-smallcaps mb-2">{t('favicon')}</div>
      <div className="flex items-center gap-3">
        <Image
          src={`/favicon.ico?v=${bust}`}
          alt={t('faviconCurrent')}
          width={28}
          height={28}
          unoptimized
          className="rounded-sm border border-(--color-rule) bg-(--color-paper)"
        />
        <SelectField
          testid="favicon-select"
          aria-label={t('favicon')}
          value={sel}
          onChange={(e) => onChange(e.target.value)}
          mono
        >
          <option value={CHOOSE}>{t('faviconChoose')}</option>
          <option value="">{t('faviconDefault')}</option>
          {images.map((a) => (
            <option key={a.asset_id} value={a.asset_id}>{a.original_filename}</option>
          ))}
        </SelectField>
      </div>
      <div className="mono text-[11px] text-(--color-muted) mt-1.5">{t('faviconHelp')}</div>
    </div>
  );
}
