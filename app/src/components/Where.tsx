// Where —— "where I am". location_line + status_prose + a list of hiring
// filter criteria (left accent 2px rule), closed with one italic line.

import { useTranslations } from 'next-intl';

import type { PageWhere } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Where({ where }: { where: PageWhere }) {
  // When the whole section is empty (unconfigured instance, defaultWhere is
  // an F-A-21-style empty shell) → not even the heading renders: the visitor
  // side never leaves a placeholder for an empty section, matching the
  // empty-state rule used by insights/projects.
  return isWhereEmpty(where) ? null : (
    <section className="mt-24">
      <DeckHeader kicker="where I am" />
      <div className="reading text-(--color-ink) text-[18px]">
        <ProseLine text={where.location_line} />
        <ProseLine text={where.status_prose} className="mt-4" />
        <LookingForList items={where.looking_for} />
        <ProseLine text={where.closing} className="font-serif italic text-(--color-muted) mt-6" />
      </div>
    </section>
  );
}

function isWhereEmpty(where: PageWhere): boolean {
  const proses = [where.location_line, where.status_prose, where.closing];
  return proses.every((s) => s === '') && where.looking_for.length === 0;
}

// ProseLine —— an empty string doesn't render: an unconfigured line must not
// leave a blank paragraph for the visitor (same class as F-A-21 — an empty
// shell placeholder counts as a leak too).
function ProseLine({ text, className }: { text: string; className?: string }) {
  return text === '' ? null : <p className={className}>{text}</p>;
}

function LookingForList({ items }: { items: readonly string[] }) {
  const t = useTranslations('page');
  return items.length === 0 ? null : (
    <>
      <p className="mt-5 mono text-[10.5px] tracking-[0.2em] uppercase text-(--color-muted)">
        {t('where.hiringFilter')}
      </p>
      <ul className="space-y-1 mt-2 pl-5 border-l-2 border-(--color-accent)/40 font-serif text-(--color-ink) text-[16.5px]">
        {items.map((f) => <li key={f}>· {f}</li>)}
      </ul>
    </>
  );
}
