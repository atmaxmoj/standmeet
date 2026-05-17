// Where I am section —— location + status prose + looking-for 列表 + 关圈语。

import type { PageWhere } from '@/lib/api/public';

export function Where({ where }: { where: PageWhere }) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 space-y-6">
      <SectionLabel text="where I am" />
      <p className="reading">{where.location_line}</p>
      <p className="reading">{where.status_prose}</p>
      <ul className="reading text-base space-y-1 list-disc pl-6">
        {where.looking_for.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="reading">{where.closing}</p>
    </section>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <header className="flex items-center gap-4">
      <span className="smallcaps">{text}</span>
      <hr className="rule rule-soft flex-1" />
    </header>
  );
}
