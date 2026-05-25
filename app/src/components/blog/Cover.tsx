// Cover —— typographic post 封面。设计源自 blog.html .cover 块：
// container-query 让同组件在 article hero 宽 + index lead 窄都 render
// 正常。radial gradient 三色 hue (amber/violet/acid)。
//
// owner 上传了 cover image → 用 image 当背景（保留 hue 着色 + headline/sub
// 叠在上面）；没传 → 纯 typographic + 三色 gradient。
//
// 样式细节全部在 Cover.module.css，data-hue / data-locked / data-img 切换
// 变体；runtime image URL 是唯一真 dynamic 值，通过 CSS var threading（下方
// 单点 eslint-disable）。

import type { CSSProperties } from 'react';

import type { PostView } from '@/lib/api/public';

import styles from '@/components/blog/Cover.module.css';

interface Props {
  cover: Pick<PostView, 'cover_headline' | 'cover_sub' | 'cover_hue' | 'cover_image_asset_id'>;
  assetURLs?: Record<string, string>;
  locked?: boolean;
  no?: string;
}

export function Cover({ cover, locked, no, assetURLs }: Props) {
  const imgURL = resolveCoverImageURL(cover.cover_image_asset_id, assetURLs);
  return (
    <div
      className={styles.cover}
      data-blog-cover
      data-hue={cover.cover_hue}
      data-img={imgURL ? '1' : undefined}
      data-locked={locked ? '1' : undefined}
      // CSS var threading：image URL 是 runtime-only 连续值，无法用 finite
      // class set 表达。--cover-img 跟 Cover.module.css 的 [data-img] 规则
      // 拼成 background-image。
      // eslint-disable-next-line no-restricted-syntax
      style={coverImgVar(imgURL)}
    >
      <CoverRule />
      <CoverHeadline text={cover.cover_headline} />
      <CoverSub text={cover.cover_sub} />
      <CoverTag />
      <CoverNumberMaybe text={no} />
      <CoverLockOverlayMaybe locked={locked} />
    </div>
  );
}

function coverImgVar(url: string | undefined): CSSProperties | undefined {
  return url ? { ['--cover-img' as string]: `url("${url}")` } : undefined;
}

function resolveCoverImageURL(
  assetID: string | undefined, assetURLs?: Record<string, string>,
): string | undefined {
  return assetID && assetURLs ? assetURLs[assetID] : undefined;
}

function CoverNumberMaybe({ text }: { text?: string }) {
  return text ? <CoverNumber text={text} /> : null;
}

function CoverLockOverlayMaybe({ locked }: { locked?: boolean }) {
  return locked ? <CoverLockOverlay /> : null;
}

function CoverRule() {
  return <div className={styles.rule} />;
}

function CoverHeadline({ text }: { text: string }) {
  return <span className={styles.headline}>{text}</span>;
}

function CoverSub({ text }: { text: string }) {
  return <span className={styles.sub}>{text}</span>;
}

function CoverTag() {
  return <span className={styles.tag}>essay · standmeet</span>;
}

function CoverNumber({ text }: { text: string }) {
  return <span className={styles.number}>{text}</span>;
}

function CoverLockOverlay() {
  return (
    <div className={styles.lockOverlay}>
      <span className="mono text-[11px] tracking-[0.2em] uppercase text-(--color-accent)">
        private · code-gated
      </span>
    </div>
  );
}
