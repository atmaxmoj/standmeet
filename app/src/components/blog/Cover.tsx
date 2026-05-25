// Cover —— typographic post 封面。设计源自 blog.html .cover 块：
// container-query 让同组件在 article hero 宽 + index lead 窄都 render
// 正常。radial gradient 三色 hue (amber/violet/acid)。
//
// owner 上传了 cover image → 用 image 当背景（保留 hue 着色 + headline/sub
// 叠在上面）；没传 → 纯 typographic + 三色 gradient。

import type { PostView } from '@/lib/api/public';

interface Props {
  cover: Pick<PostView, 'cover_headline' | 'cover_sub' | 'cover_hue' | 'cover_image_asset_id'>;
  assetURLs?: Record<string, string>;
  locked?: boolean;
  no?: string;
}

// HUE_GRADIENT —— 只放 image layers (radial-gradient)；surface color 走
// backgroundColor 单出。混 url(...) 和 var(color) 在 background shorthand 里
// 会被 browser reject 成 invalid → "none"。
const HUE_GRADIENT: Record<PostView['cover_hue'], string> = {
  amber:
    'radial-gradient(ellipse 60% 80% at 80% 20%, color-mix(in oklab, #C7892F 30%, transparent), transparent 70%),' +
    'radial-gradient(ellipse 50% 70% at 10% 100%, color-mix(in oklab, #C7892F 18%, transparent), transparent 70%)',
  violet:
    'radial-gradient(ellipse 60% 80% at 80% 20%, color-mix(in oklab, #7A4D9E 22%, transparent), transparent 70%),' +
    'radial-gradient(ellipse 50% 70% at 10% 100%, color-mix(in oklab, #7A4D9E 14%, transparent), transparent 70%)',
  acid:
    'radial-gradient(ellipse 60% 80% at 80% 20%, color-mix(in oklab, #6F8A2F 26%, transparent), transparent 70%),' +
    'radial-gradient(ellipse 50% 70% at 10% 100%, color-mix(in oklab, #6F8A2F 14%, transparent), transparent 70%)',
};

const COVER_SURFACE = 'var(--color-surface, #ECE6D8)';

export function Cover({ cover, locked, no, assetURLs }: Props) {
  const imgURL = resolveCoverImageURL(cover.cover_image_asset_id, assetURLs);
  return (
    <div
      className="relative overflow-hidden border border-(--color-rule)"
      data-blog-cover
      style={coverStyle(cover.cover_hue, locked, imgURL)}
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

function resolveCoverImageURL(
  assetID: string | undefined, assetURLs?: Record<string, string>,
): string | undefined {
  return assetID && assetURLs ? assetURLs[assetID] : undefined;
}

function coverStyle(
  hue: PostView['cover_hue'], locked?: boolean, imgURL?: string,
): React.CSSProperties {
  return {
    aspectRatio: '21 / 9',
    containerType: 'inline-size',
    backgroundImage: backgroundImageFor(hue, imgURL),
    backgroundColor: COVER_SURFACE,
    ...imageFitStyle(imgURL),
    filter: locked ? 'grayscale(0.7) blur(0.5px)' : undefined,
  };
}

function imageFitStyle(imgURL?: string): React.CSSProperties {
  return imgURL ? { backgroundSize: 'cover', backgroundPosition: 'center' } : {};
}

// backgroundImageFor —— 有 imgURL 把图片叠在 hue gradient 下层（gradient
// 半透在上层 → 保留 standmeet 三色色调 + 文字可读性）；无 imgURL 走纯 gradient。
function backgroundImageFor(hue: PostView['cover_hue'], imgURL?: string): string {
  const gradient = hueGradient(hue);
  return imgURL ? `${gradient}, url("${imgURL}")` : gradient;
}

function hueGradient(hue: PostView['cover_hue']): string {
  return HUE_GRADIENT[hue] ?? HUE_GRADIENT.amber;
}

function CoverNumberMaybe({ text }: { text?: string }) {
  return text ? <CoverNumber text={text} /> : null;
}

function CoverLockOverlayMaybe({ locked }: { locked?: boolean }) {
  return locked ? <CoverLockOverlay /> : null;
}

function CoverRule() {
  return (
    <div
      className="absolute"
      style={{
        left: '6%', right: '6%', top: '50%', height: '1px',
        background: 'var(--color-rule)',
      }}
    />
  );
}

function CoverHeadline({ text }: { text: string }) {
  return (
    <span
      className="absolute font-serif text-(--color-ink)"
      style={{
        top: '14%', left: '6%', maxWidth: '76%',
        fontSize: 'clamp(28px, 11cqi, 96px)',
        fontWeight: 400, letterSpacing: '-0.025em', lineHeight: 0.92,
      }}
    >
      {text}
    </span>
  );
}

function CoverSub({ text }: { text: string }) {
  return (
    <span
      className="absolute italic text-(--color-muted)"
      style={{
        bottom: '14%', right: '6%', maxWidth: '70%', textAlign: 'right',
        fontSize: 'clamp(20px, 7.5cqi, 64px)',
        fontWeight: 400, letterSpacing: '-0.025em', lineHeight: 0.92,
        fontFamily: '"Newsreader", serif',
      }}
    >
      {text}
    </span>
  );
}

function CoverTag() {
  return (
    <span
      className="mono absolute uppercase text-(--color-muted)"
      style={{
        top: 14, left: 14,
        fontSize: 'clamp(8px, 1.4cqi, 11px)',
        letterSpacing: '0.18em',
      }}
    >
      essay · standmeet
    </span>
  );
}

function CoverNumber({ text }: { text: string }) {
  return (
    <span
      className="mono absolute uppercase text-(--color-faint)"
      style={{
        bottom: 14, left: 14,
        fontSize: 'clamp(8px, 1.4cqi, 11px)',
        letterSpacing: '0.16em',
      }}
    >
      {text}
    </span>
  );
}

function CoverLockOverlay() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background:
          'repeating-linear-gradient(45deg, transparent 0 6px,' +
          ' color-mix(in oklab, var(--color-ink) 8%, transparent) 6px 7px),' +
          ' color-mix(in oklab, var(--color-paper) 80%, transparent)',
      }}
    >
      <span className="mono text-[11px] tracking-[0.2em] uppercase text-(--color-accent)">
        private · code-gated
      </span>
    </div>
  );
}
