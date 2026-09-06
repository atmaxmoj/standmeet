// SeoPanel — per-page SEO (title + description) injected into the served page's <head>. SEO
// follows each microsite (not a global settings section). Shown for an existing page; a new page
// has no row to set SEO on until it is created + listed.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useMicrosites, seoInit, type MicrositeSummary } from '@/lib/admin/use-microsites';
import { useAction } from '@/lib/ui/use-action';

export function SeoPanel({ slug, isNew }: { slug: string; isNew: boolean }) {
  const { rows, setSEO } = useMicrosites();
  const row = rows.find((r) => r.slug === slug.trim());
  return (isNew || row === undefined)
    ? null
    : <SeoForm slug={slug.trim()} row={row} setSEO={setSEO} />;
}

interface SeoFormProps {
  slug: string;
  row: MicrositeSummary;
  setSEO: (slug: string, title: string, description: string, image: string) => Promise<void>;
}

function SeoForm({ slug, row, setSEO }: SeoFormProps) {
  const t = useTranslations('adminPages.microsites');
  const run = useAction();
  const init = seoInit(row);
  const [title, setTitle] = useState(init.title);
  const [desc, setDesc] = useState(init.desc);
  const [image, setImage] = useState(init.image);
  const save = useCallback(() => {
    void run(() => setSEO(slug, title.trim(), desc.trim(), image.trim()), { success: 'SEO updated' });
  }, [run, setSEO, slug, title, desc, image]);
  return (
    <details className="mt-4" data-testid="microsite-seo">
      <summary className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) cursor-pointer">
        {t('seoHeading')}
      </summary>
      <div className="mt-2 space-y-2">
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false}
          placeholder="page title (browser tab + search)" data-testid="microsite-seo-title"
          className="sm-field-input w-full"
        />
        <textarea
          value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} spellCheck={false}
          placeholder="one-line description for search results" data-testid="microsite-seo-desc"
          className="w-full bg-transparent border border-(--color-rule) p-2 reading-tight text-[13px]"
        />
        <input
          value={image} onChange={(e) => setImage(e.target.value)} spellCheck={false}
          placeholder="share-card image URL (og:image)" data-testid="microsite-seo-image"
          className="sm-field-input w-full"
        />
        <button type="button" onClick={save} data-testid="microsite-seo-save" className="sm-btn sm-btn-sm">
          {t('seoSave')}
        </button>
      </div>
    </details>
  );
}
