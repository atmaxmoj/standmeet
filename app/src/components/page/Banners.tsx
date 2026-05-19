// Banners —— ByoaiBanner / CodedBanner。两个 narrow 用途的小条，BYOAI 模式
// 提示"public scope" + 私问需要 code，coded session 提示当前哪张码 + visitor
// 名。crosshair-banner 给 corner crosshair 装饰，符合 design 的 tech-vitality
// 反 SaaS 美学。

import Link from 'next/link';

export function ByoaiBanner({ provider }: { provider: string }) {
  return (
    <BannerShell>
      <BannerLeft testId="byoai-banner">
        <LiveTag label="byoai mode" />
        <Dot />
        <span className="text-(--color-muted)">model · {provider}</span>
        <Dot />
        <span className="text-(--color-muted)">public scope</span>
      </BannerLeft>
      <BannerRight>
        <span className="text-(--color-faint) normal-case tracking-[0.06em]">
          private topics return &ldquo;need a code&rdquo;
        </span>
        <Link href="/alice/gate#request" className="text-(--color-muted) hover:text-(--color-accent) transition-colors">
          request a code ↗
        </Link>
      </BannerRight>
    </BannerShell>
  );
}

export function CodedBanner({ code, visitor }: { code: string; visitor: string | null }) {
  return (
    <BannerShell>
      <BannerLeft>
        <LiveTag label="invited" />
        <Dot />
        <span className="text-(--color-muted)">code · {code}</span>
        {visitor && <Dot />}
        {visitor && (
          <span className="text-(--color-muted)">
            you · <span className="text-(--color-ink) normal-case tracking-[0.04em]">{visitor}</span>
          </span>
        )}
      </BannerLeft>
      <BannerRight>
        <span className="text-(--color-faint) normal-case tracking-[0.06em]">
          alice reviews transcripts
        </span>
      </BannerRight>
    </BannerShell>
  );
}

function BannerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-6 lg:mx-0 mt-6 max-w-[760px] lg:mx-auto">
      <div className="crosshair-banner relative border border-(--color-accent)/40 bg-(--color-paper)/60 px-4 py-3 flex items-baseline justify-between gap-4 flex-wrap">
        {children}
      </div>
    </div>
  );
}

function BannerLeft({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div
      className="mono text-[10.5px] tracking-[0.16em] uppercase flex items-baseline gap-3 flex-wrap"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function BannerRight({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase flex items-baseline gap-4">
      {children}
    </div>
  );
}

function LiveTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) live-dot" />
      <span className="text-(--color-accent)">{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-(--color-faint)">·</span>;
}
