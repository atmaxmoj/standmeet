// Footer —— "N entries · updated 3 days ago · grounded retrieval, no
// open-web fallback · admin↗"。设计稿里它是页面信任落脚点：让 visitor
// 知道答的话源于固定 corpus，不是 ChatGPT 凭空说。
//
// corpusSize + lastUpdated 后续 backend extend `/api/v1/page` 时再注入；
// 现在 props 可选，缺省 fallback 到不带数字的版本。

import Link from 'next/link';

type Props = {
  corpusSize?: number | null;
  lastUpdated?: string | null;
};

export function Footer({ corpusSize, lastUpdated }: Props) {
  return (
    <footer className="border-t border-(--color-rule) mt-28">
      <div className="max-w-[760px] mx-auto px-6 md:px-0 py-9 mono text-[11px] leading-[1.7] text-(--color-muted) flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <FooterStats corpusSize={corpusSize} lastUpdated={lastUpdated} />
        <div className="flex items-baseline gap-3">
          <span className="text-(--color-faint)">standmeet</span>
          <Link className="hover:text-(--color-ink) transition-colors" href="/gate">
            request access ↗
          </Link>
          <span className="text-(--color-faint)">·</span>
          <Link className="hover:text-(--color-ink) transition-colors" href="/admin">
            admin ↗
          </Link>
        </div>
      </div>
    </footer>
  );
}

function FooterStats({ corpusSize, lastUpdated }: Props) {
  return (
    <div>
      <CorpusCount n={corpusSize} />
      <UpdatedAt at={lastUpdated} />
      <span>grounded retrieval, no open-web fallback</span>
    </div>
  );
}

function CorpusCount({ n }: { n?: number | null }) {
  return typeof n === 'number' ? (
    <>
      <span className="text-(--color-ink)">{n.toLocaleString()}</span>
      {' entries'}
      <span className="mx-2 text-(--color-faint)">·</span>
    </>
  ) : null;
}

function UpdatedAt({ at }: { at?: string | null }) {
  return isNonEmpty(at) ? (
    <>
      {'updated '}{at}
      <span className="mx-2 text-(--color-faint)">·</span>
    </>
  ) : null;
}

function isNonEmpty(s: string | null | undefined): s is string {
  return typeof s === 'string' && s !== '';
}
