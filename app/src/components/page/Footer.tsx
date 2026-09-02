// Footer —— "N entries · updated 3 days ago · grounded retrieval, no
// open-web fallback · admin↗". In the design spec this is the page's trust
// anchor: it lets the visitor know the answer comes from a fixed corpus,
// not something ChatGPT made up on the spot.
//
// corpusSize + lastUpdated will be injected once the backend extends
// `/api/v1/page`; for now the props are optional and default to falling
// back to the version without numbers.

import Link from 'next/link';
import { useTranslations } from 'next-intl';

type Props = {
  corpusSize?: number | null;
  lastUpdated?: string | null;
};

export function Footer({ corpusSize, lastUpdated }: Props) {
  const t = useTranslations('page');
  return (
    <footer className="border-t border-(--color-rule) mt-28">
      <div className="max-w-[760px] mx-auto px-6 md:px-0 py-9 mono text-[11px] leading-[1.7] text-(--color-muted) flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <FooterStats corpusSize={corpusSize} lastUpdated={lastUpdated} />
        <div className="flex items-baseline gap-3">
          <span className="text-(--color-faint)">{t('brand')}</span>
          {/* No admin link: visitors / recruiters shouldn't see an admin entry
              point; the owner types /admin themselves (bookmark). The e2e
              fixture simulates the same behavior with adminPage. */}
          <Link className="hover:text-(--color-ink) transition-colors" href="/gate">
            {t('footer.requestAccess')}
          </Link>
        </div>
      </div>
    </footer>
  );
}

function FooterStats({ corpusSize, lastUpdated }: Props) {
  const t = useTranslations('page');
  return (
    <div>
      <CorpusCount n={corpusSize} />
      <UpdatedAt at={lastUpdated} />
      <span>{t('footer.grounded')}</span>
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
