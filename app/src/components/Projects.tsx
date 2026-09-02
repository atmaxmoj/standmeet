// Projects —— "what I'm building". Like insights, projects is a pin window
// over the corpus (docs/design/page-corpus-pinning.md): each card is a
// pinned published entry, with name=title linking to /wiki/<path>, and the
// excerpt shown in a reading area with a left 1px rule.
// An empty section (nothing pinned) doesn't render at all, not even the
// heading.

import Link from 'next/link';

import { corpusHref } from '@/lib/corpus/href';
import type { PagePinCard } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Projects({ projects }: { projects: readonly PagePinCard[] }) {
  return projects.length === 0 ? null : (
    <section className="mt-24">
      <DeckHeader kicker="what I'm building" count={projects.length} />
      <ul className="space-y-9">
        {projects.map((card) => <ProjectRow key={card.wiki_id} card={card} />)}
      </ul>
    </section>
  );
}

function ProjectRow({ card }: { card: PagePinCard }) {
  return (
    <li>
      <Link href={corpusHref({ genre: 'wiki', path: card.path })} className="group flex items-baseline gap-3 flex-wrap mb-3">
        <h3 className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[24px] font-medium tracking-[-0.012em] leading-[1.1]">
          {card.title}
        </h3>
        <span className="mono text-(--color-faint)">{'──'}</span>
        <span className="mono text-[11px] tracking-[0.14em] text-(--color-faint) group-hover:text-(--color-muted) transition-colors">
          {'read ↗'}
        </span>
      </Link>
      {card.excerpt !== '' && (
        <div className="reading text-(--color-ink) pl-5 border-l border-(--color-rule) text-[16px]">
          <p>{card.excerpt}</p>
        </div>
      )}
    </li>
  );
}
