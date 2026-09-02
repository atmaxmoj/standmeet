// CorpusMedia —— the three render sites, on the **visitor side**, for the
// media attached to a piece of corpus.
//
// wiki and output share this one implementation: `standmeet-asset:<id>` in
// the body expands into a reachable URL, hero lays out the owner-set cover
// image, and attachments render as a download area with real byte counts.
//
// It's pulled out here because the output path **wasn't wired up at all**
// at first — while the SDK carried a comment claiming "structure matches
// WikiLandingView". Writing a separate copy per genre means the next genre
// that gets wired up will drop it again the same way; and a dropped media
// path looks like "the page looks fine, the image just isn't there" — no
// error, nobody goes looking.

// **This file is a client component.** The two pure functions
// (expandBody / coverURL) live in lib/corpus/media.ts — they carry no
// 'use client', so **server components can call them too**.
//
// output's landing page is a Server Component: putting the pure functions
// into this file instead would turn any call into
// "Attempted to call coverURL() from the server but coverURL is on the client",
// a full page 500. wiki's path is client, so it wouldn't error — a bug that
// only blows up on one of the two paths.

'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';

import { formatBytes } from '@/lib/format/bytes';
import type { CorpusAsset } from '@/lib/corpus/media';

/**
 * CoverImage —— lays the owner-set image over the hero.
 *
 * `unoptimized`: the URL is a pre-signed URL on the owner's own storage
 * (different per deployment, with an expiring signature). Next's image
 * optimizer returns 400 for a host not in images.remotePatterns, and going
 * through /_next/image renders a broken image (writings hit this already —
 * see F-I-1 in Cover.tsx).
 *
 * testid hangs on the outer span: a testid is the test's concern, and it
 * can only land on a real DOM element.
 */
export function CoverImage({ url, testid }: { url?: string; testid: string }) {
  return url ? (
    <span data-testid={testid}>
      <Image src={url} alt="" fill unoptimized className="object-cover" />
    </span>
  ) : null;
}

/**
 * Attachments —— the download area beneath the body. Lists attachments
 * only; images belong to the body.
 *
 * Each row states **filename + real size** — that's what a visitor decides
 * whether to click on. A button that just says "download" makes a 40-page
 * PDF and a screenshot look like the same thing. The whole block doesn't
 * render when there are no attachments: an empty heading over blank space
 * is worse than nothing.
 */
export function Attachments(
  { assets, testid }: { assets?: readonly CorpusAsset[]; testid: string },
) {
  const t = useTranslations('reader');
  const files = (assets ?? []).filter((a) => a.kind === 'attachment');
  return files.length > 0 ? (
    <section className="mt-10 pt-5 border-t border-(--color-rule)" data-testid={testid}>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-2">
        {t('wiki.attachments')}
      </span>
      <ul className="space-y-1">
        {files.map((a) => <AttachmentRow key={a.asset_id} asset={a} />)}
      </ul>
    </section>
  ) : null;
}

function AttachmentRow({ asset }: { asset: CorpusAsset }) {
  return (
    <li className="flex items-baseline gap-3 mono text-[11.5px]">
      <a
        href={asset.url}
        download={asset.original_filename}
        data-testid={`corpus-attachment-${asset.asset_id}`}
        className="text-(--color-ink) hover:text-(--color-accent)"
      >
        {asset.original_filename}
      </a>
      <span className="text-(--color-faint)">{formatBytes(asset.size_bytes)}</span>
    </li>
  );
}
