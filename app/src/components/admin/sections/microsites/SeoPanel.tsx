// SeoPanel — per-page SEO (title + description) injected into the served page's <head>. SEO
// follows each microsite (not a global settings section).
//
// No condition beyond "there is a page to save to": if the owner can open this editor, they can set
// SEO — the homepage especially, which is always a real destination at `/` but is not materialized
// as a `home` row until it is first customized. So the panel renders whenever the editor has a
// concrete slug (empty only on a brand-new page before it is named), even when no microsite row
// exists yet; Save materializes the page (the backend upserts the row before writing the SEO).

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  useMicrosites, useHomepageSeoInit, seoPanelInit, type SeoInit,
} from '@/lib/admin/use-microsites';
import { useAction } from '@/lib/ui/use-action';

// HOMEPAGE_SLUG — the reserved site-root page. Its SEO lives on the owner (decoupled from the
// `home` microsite), so the panel loads/saves it there, not via a microsite row.
const HOMEPAGE_SLUG = 'home';

export function SeoPanel({ slug }: { slug: string }) {
  const { rows, setSEO } = useMicrosites();
  const trimmed = slug.trim();
  const isHome = trimmed === HOMEPAGE_SLUG;
  // The homepage loads its current SEO from the owner store; a /p page reads its own row.
  const home = useHomepageSeoInit(isHome);
  const { init, ready } = seoPanelInit(isHome, home, rows.find((r) => r.slug === trimmed));
  // A brand-new page has no slug until it is named; the homepage waits for its owner-store SEO to
  // load so the fields show the real values, not a flash of empty (`ready`).
  return (trimmed === '' || !ready)
    ? null
    : (
      <SeoForm
        key={`${trimmed}:${init.title}:${init.desc}:${init.image}`}
        slug={trimmed} init={init} setSEO={setSEO}
      />
    );
}

interface SeoFormProps {
  slug: string;
  init: SeoInit;
  setSEO: (slug: string, title: string, description: string, image: string) => Promise<void>;
}

function SeoForm({ slug, init, setSEO }: SeoFormProps) {
  const t = useTranslations('adminPages.microsites');
  const run = useAction();
  const [title, setTitle] = useState(init.title);
  const [desc, setDesc] = useState(init.desc);
  const [image, setImage] = useState(init.image);
  const save = useCallback(() => {
    void run(() => setSEO(slug, title.trim(), desc.trim(), image.trim()), { success: t('seoUpdated') });
  }, [run, setSEO, slug, title, desc, image, t]);
  return (
    <details className="mt-4" data-testid="microsite-seo">
      <summary className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) cursor-pointer">
        {t('seoHeading')}
      </summary>
      <div className="mt-2 space-y-2">
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false}
          placeholder={t('seoTitlePlaceholder')} data-testid="microsite-seo-title"
          className="sm-field-input w-full"
        />
        <textarea
          value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} spellCheck={false}
          placeholder={t('seoDescPlaceholder')} data-testid="microsite-seo-desc"
          className="w-full bg-transparent border border-(--color-rule) p-2 reading-tight text-[13px]"
        />
        <input
          value={image} onChange={(e) => setImage(e.target.value)} spellCheck={false}
          placeholder={t('seoImagePlaceholder')} data-testid="microsite-seo-image"
          className="sm-field-input w-full"
        />
        <button type="button" onClick={save} data-testid="microsite-seo-save" className="sm-btn sm-btn-sm">
          {t('seoSave')}
        </button>
      </div>
    </details>
  );
}
