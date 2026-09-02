// Cover —— typographic writing cover. Container queries let the same
// component render correctly both wide (article hero) and narrow (index
// lead). Radial gradient uses a three-color hue.
// Owner uploaded a cover image → <img> background; none uploaded → pure
// typographic + gradient.

'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';

import type { WritingView } from '@/lib/api/public';
import { coverURL } from '@/lib/corpus/media';

import styles from '@/components/writings/Cover.module.css';

interface Props {
  // The subtitle is just the writing's excerpt (card excerpt / og / cover
  // subtitle all share one field).
  cover: Pick<WritingView, 'cover_headline' | 'excerpt' | 'cover_hue' | 'cover_image_asset_id'>;
  assetURLs?: Record<string, string>;
  locked?: boolean;
  no?: string;
}

export function Cover({ cover, locked, no, assetURLs }: Props) {
  // coverURL is the shared one from the corpus module — this file used to have
  // its own resolveCoverImageURL, identical in every way. Two implementations
  // of the same thing means a change to one leaks a gap in the other.
  const imgURL = coverURL(cover.cover_image_asset_id, assetURLs);
  return (
    <div
      className={styles.cover}
      data-writing-cover
      data-hue={cover.cover_hue}
      data-locked={locked ? '1' : undefined}
    >
      <CoverImageMaybe url={imgURL} />
      <CoverVeilMaybe url={imgURL} />
      <CoverRule />
      <CoverHeadline text={cover.cover_headline} />
      <CoverSub text={cover.excerpt} />
      <CoverTag />
      <CoverNumberMaybe text={no} />
      <CoverLockOverlayMaybe locked={locked} />
    </div>
  );
}

// CoverVeilMaybe —— lay a text-protection veil only when there's an image
// (UX-83). A cover with no image is already paper-colored underneath, so it
// needs no veil.
function CoverVeilMaybe({ url }: { url?: string }) {
  return url ? <div className={styles.veil} /> : null;
}

function CoverImageMaybe({ url }: { url?: string }) {
  // `unoptimized`: the src is a presigned URL on the owner's storage origin (STORAGE_PUBLIC_URL,
  // arbitrary per-deployment, with an expiring signature). Next's image optimizer rejects any
  // host not in images.remotePatterns with a 400, so routing it through /_next/image renders a
  // broken image (F-I-1). Serve it directly. remotePatterns can't enumerate owner-set origins.
  return url ? (
    <Image src={url} alt="" fill unoptimized className={styles.coverImg} />
  ) : null;
}

function CoverNumberMaybe({ text }: { text?: string }) {
  return text ? <CoverNumber text={text} /> : null;
}

function CoverLockOverlayMaybe({ locked }: { locked?: boolean }) {
  return locked ? <CoverLockOverlay /> : null;
}

function CoverRule() { return <div className={styles.rule} />; }

// fitCqi —— what font size this text should use (unit: cqi, relative to
// cover width).
//
// Why this needs computing: the cover is a **fixed-aspect-ratio** box
// (21/9 + overflow:hidden), while font size originally tracked only
// container width (`clamp(20px, 7.5cqi, 64px)`). A short headline
// ("wedge.") looks great, but a full sentence blows out the box —
// in prod, one essay's excerpt was 125 characters; `.sub`, anchored at
// `bottom:14%` and growing upward, overflowed straight past the top of the
// cover and got clipped, so the first line was unreadable. Font size not
// tracking **how much text there is** was bound to break eventually.
//
// The relationship is derived, not tuned by trial: in a column of width W
// with N characters at font size F, line count ≈ N·k·F/W, and height ≈
// N·k·F²/W. Setting that equal to the available height H gives
// **F ∝ √(H·W/N)** — i.e. F ∝ 1/√N.
// K is fixed by the constraint that the existing, already-designed short
// headline must not change: the ceiling stays the original clamp, and only
// longer text scales down from there.
function fitCqi(text: string, maxCqi: number): number {
  const n = Math.max(text.trim().length, 1);
  return Math.min(maxCqi, FIT_K / Math.sqrt(n));
}

// FIT_K —— proportionality constant derived from "a 6-character headline
// should reach the design ceiling" (11 × √6 ≈ 27; picked 45 instead so
// medium-length text doesn't shrink too fast — the ceiling side is still
// capped by each element's own clamp, so this constant only affects long
// text).
const FIT_K = 45;

// fitStyle —— hands the computed font size to CSS. Custom properties aren't
// among the keys of `CSSProperties`, so the type is `Record` instead of a
// type assertion (the gate bans `as`, and an assertion here would really
// just be talking the compiler into it anyway).
function fitStyle(text: string, maxCqi: number): Record<string, string> {
  return { '--fit-cqi': String(fitCqi(text, maxCqi)) };
}

function CoverHeadline({ text }: { text: string }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- font size is computed from content length, only known at runtime
    <span className={styles.headline} style={fitStyle(text, 11)}>{text}</span>
  );
}

function CoverSub({ text }: { text: string }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- same as above: this value can only be computed once the text is available
    <span className={styles.sub} style={fitStyle(text, 7.5)}>{text}</span>
  );
}
function CoverTag() {
  const t = useTranslations('writings.cover');
  return <span className={styles.tag}>{t('tag')}</span>;
}
function CoverNumber({ text }: { text: string }) { return <span className={styles.number}>{text}</span>; }

function CoverLockOverlay() {
  const t = useTranslations('writings.cover');
  return (
    <div className={styles.lockOverlay}>
      <span className="mono text-[11px] tracking-[0.2em] uppercase text-(--color-accent)">
        {t('locked')}
      </span>
    </div>
  );
}
