// Cover —— typographic writing 封面。container-query 让同组件在 article
// hero 宽 + index lead 窄都 render 正常。radial gradient 三色 hue。
// owner 上传了 cover image → <img> 背景；没传 → 纯 typographic + gradient。

import Image from 'next/image';

import type { WritingView } from '@/lib/api/public';

import styles from '@/components/writings/Cover.module.css';

interface Props {
  // 副标题就是 writing 的 excerpt（卡片 excerpt / og / cover 副标题共用一个字段）。
  cover: Pick<WritingView, 'cover_headline' | 'excerpt' | 'cover_hue' | 'cover_image_asset_id'>;
  assetURLs?: Record<string, string>;
  locked?: boolean;
  no?: string;
}

export function Cover({ cover, locked, no, assetURLs }: Props) {
  const imgURL = resolveCoverImageURL(cover.cover_image_asset_id, assetURLs);
  return (
    <div
      className={styles.cover}
      data-writing-cover
      data-hue={cover.cover_hue}
      data-locked={locked ? '1' : undefined}
    >
      <CoverImageMaybe url={imgURL} />
      <CoverRule />
      <CoverHeadline text={cover.cover_headline} />
      <CoverSub text={cover.excerpt} />
      <CoverTag />
      <CoverNumberMaybe text={no} />
      <CoverLockOverlayMaybe locked={locked} />
    </div>
  );
}

function resolveCoverImageURL(
  assetID: string | undefined, assetURLs?: Record<string, string>,
): string | undefined {
  return assetID && assetURLs ? assetURLs[assetID] : undefined;
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
function CoverHeadline({ text }: { text: string }) { return <span className={styles.headline}>{text}</span>; }
function CoverSub({ text }: { text: string }) { return <span className={styles.sub}>{text}</span>; }
function CoverTag() { return <span className={styles.tag}>essay · standmeet</span>; }
function CoverNumber({ text }: { text: string }) { return <span className={styles.number}>{text}</span>; }

function CoverLockOverlay() {
  return (
    <div className={styles.lockOverlay}>
      <span className="mono text-[11px] tracking-[0.2em] uppercase text-(--color-accent)">
        private · code-gated
      </span>
    </div>
  );
}
