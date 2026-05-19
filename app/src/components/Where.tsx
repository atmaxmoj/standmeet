// Where —— "where I am"。location_line + status_prose + 一个 list 是
// hiring 过滤条件（左侧 accent 2px rule），结尾一句 italic 收。

import type { PageWhere } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Where({ where }: { where: PageWhere }) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="where I am" />
      <div className="reading text-(--color-ink)" style={{ fontSize: '18px' }}>
        <p>{where.location_line}</p>
        <p className="mt-4">{where.status_prose}</p>
        <LookingForList items={where.looking_for} />
        <p className="font-serif italic text-(--color-muted) mt-6">{where.closing}</p>
      </div>
    </section>
  );
}

function LookingForList({ items }: { items: readonly string[] }) {
  return items.length === 0 ? null : (
    <>
      <p className="mt-5 mono text-[10.5px] tracking-[0.2em] uppercase text-(--color-muted)">
        if you&apos;re hiring, it should fit all of these
      </p>
      <ul
        className="space-y-1 mt-2 pl-5 border-l-2 border-(--color-accent)/40 font-serif text-(--color-ink)"
        style={{ fontSize: '16.5px' }}
      >
        {items.map((f) => <li key={f}>· {f}</li>)}
      </ul>
    </>
  );
}
