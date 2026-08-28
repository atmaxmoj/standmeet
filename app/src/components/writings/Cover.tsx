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

// fitCqi —— 这段字该用多大的字号（单位 cqi，相对封面宽度）。
//
// 为什么要算：封面是**固定比例**的框（21/9 + overflow:hidden），而字号原本只跟容器宽度走
// （`clamp(20px, 7.5cqi, 64px)`）。短标题（"wedge."）好看，一整句就爆框 ——
// prod 上那篇 essay 的 excerpt 是 125 个字符，`.sub` 锚在 `bottom:14%` 往上长，
// 直接从封面顶端溢出去被切掉，第一行读不到。字号不跟**文本有多少**走，这是必然的。
//
// 关系是推出来的，不是试出来的：宽 W 的列里 N 个字符、字号 F，行数 ≈ N·k·F/W，
// 高度 ≈ N·k·F²/W。要它等于可用高度 H，就得到 **F ∝ √(H·W/N)** —— 也就是 F ∝ 1/√N。
// K 由「现有那个设计好的短标题不许变样」定：上限仍是原来的 clamp，长文本才往下走。
function fitCqi(text: string, maxCqi: number): number {
  const n = Math.max(text.trim().length, 1);
  return Math.min(maxCqi, FIT_K / Math.sqrt(n));
}

// FIT_K —— 由「一个 6 字符的标题应当撑到设计上限」定出来的比例常数（11 × √6 ≈ 27，
// 取 45 让中等长度不至于缩得过快；上限那一侧由各自的 clamp 兜着，所以它只影响长文本）。
const FIT_K = 45;

// fitStyle —— 把算出来的字号交给 CSS。自定义属性不在 `CSSProperties` 的键里，所以类型
// 走 `Record`，不写类型断言（闸门禁 `as`，而断言在这里也确实只是把编译器说服了）。
function fitStyle(text: string, maxCqi: number): Record<string, string> {
  return { '--fit-cqi': String(fitCqi(text, maxCqi)) };
}

function CoverHeadline({ text }: { text: string }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- 字号由内容长度算出,运行时才知道
    <span className={styles.headline} style={fitStyle(text, 11)}>{text}</span>
  );
}

function CoverSub({ text }: { text: string }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- 同上:这一个值只能在拿到文本后算
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
