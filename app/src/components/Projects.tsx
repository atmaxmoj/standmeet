// Projects —— "what I'm building"。projects 跟 insights 一样是 corpus 的 pin
// 窗口(docs/design/page-corpus-pinning.md):每张卡是被 pin 的已发布条目,
// name=title 链去 /wiki/<path>,excerpt 走左侧 1px rule 的阅读区。
// 空栏目(没 pin)整个不渲染,标题也不渲。

import Link from 'next/link';

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
      <Link href={`/wiki/${card.path}`} className="group flex items-baseline gap-3 flex-wrap mb-3">
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
