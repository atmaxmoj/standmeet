// Where —— "where I am"。location_line + status_prose + 一个 list 是
// hiring 过滤条件（左侧 accent 2px rule），结尾一句 italic 收。

import { useTranslations } from 'next-intl';

import type { PageWhere } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Where({ where }: { where: PageWhere }) {
  // 整段空(未配置实例,defaultWhere 是 F-A-21 空壳)→ 连标题都不渲染:visitor
  // 面不给空栏目留占位,跟 insights/projects 的空态规则一致。
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

// ProseLine —— 空串不渲：未配置的行不能给 visitor 留空白段落（F-A-21 同类，
// 空壳占位也算泄漏）。
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
