// Cover —— typographic writing 封面。container-query 让同组件在 article
// hero 宽 + index lead 窄都 render 正常。radial gradient 三色 hue。
// owner 上传了 cover image → <img> 背景；没传 → 纯 typographic + gradient。

'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';

import type { WritingView } from '@/lib/api/public';
import { coverURL } from '@/lib/corpus/media';

import styles from '@/components/writings/Cover.module.css';

interface Props {
  // 副标题就是 writing 的 excerpt（卡片 excerpt / og / cover 副标题共用一个字段）。
  cover: Pick<WritingView, 'cover_headline' | 'excerpt' | 'cover_hue' | 'cover_image_asset_id'>;
  assetURLs?: Record<string, string>;
  locked?: boolean;
  no?: string;
}

export function Cover({ cover, locked, no, assetURLs }: Props) {
  // coverURL 是 corpus 那套共用的那一个 —— 这里以前有一份自己的 resolveCoverImageURL,
  // 一模一样。同一件事两份实现,改一处就会漏另一处。
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

// CoverVeilMaybe —— 有图才铺护字层（UX-83）。没有图的封面本来就是纸色底，不需要护。
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
function CoverHeadline({ text }: { text: string }) { return <span className={styles.headline}>{text}</span>; }
function CoverSub({ text }: { text: string }) { return <span className={styles.sub}>{text}</span>; }
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
