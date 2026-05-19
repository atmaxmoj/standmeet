// AdminSidebar —— 7-entry section nav。每项 serif label + mono hint。
// 顶部挂 SystemPulse（语料库脉搏占位 sparkline）。

import Link from 'next/link';

import { SystemPulse } from './chrome/SystemPulse';

export type AdminSlug =
  | 'raw' | 'wiki' | 'conversations' | 'codes' | 'requests'
  | 'connectors' | 'page' | 'api-mcp';

interface SectionDef {
  slug: AdminSlug;
  label: string;
  hint: string;
}

const SECTIONS: readonly SectionDef[] = [
  { slug: 'page',          label: 'page',          hint: 'public content' },
  { slug: 'raw',           label: 'raw',           hint: 'inbox' },
  { slug: 'wiki',          label: 'wiki',          hint: 'curated' },
  { slug: 'conversations', label: 'conversations', hint: 'sessions' },
  { slug: 'codes',         label: 'codes',         hint: 'access' },
  { slug: 'requests',      label: 'requests',      hint: 'visitor notes' },
  { slug: 'connectors',    label: 'connectors',    hint: 'integrations' },
  { slug: 'api-mcp',       label: 'api · mcp',     hint: 'tokens' },
];

type Props = { active: AdminSlug };

export function AdminSidebar({ active }: Props) {
  return (
    <nav className="border-r border-(--color-rule) px-5 lg:px-6 py-7 flex flex-col">
      <SystemPulse />
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        manage
      </div>
      <ul className="flex flex-col">
        {SECTIONS.map((s) => (
          <SidebarItem key={s.slug} section={s} active={s.slug === active} />
        ))}
      </ul>
      <SidebarFooter />
    </nav>
  );
}

function SidebarItem({ section, active }: { section: SectionDef; active: boolean }) {
  const tone = active ? 'text-(--color-ink)' : 'text-(--color-muted) hover:text-(--color-ink)';
  return (
    <li>
      <Link
        href={`/admin/${section.slug}`}
        data-testid={`nav-${section.slug}`}
        className={`group w-full text-left flex items-baseline gap-3 py-2 transition-colors ${tone}`}
      >
        <SidebarItemMarker active={active} />
        <span className={`font-serif flex-1 text-[17px] tracking-[-0.005em] ${active ? 'font-medium' : ''}`}>
          {section.label}
        </span>
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint)">
          {section.hint}
        </span>
      </Link>
    </li>
  );
}

function SidebarItemMarker({ active }: { active: boolean }) {
  const cls = active ? 'text-(--color-accent)' : 'text-(--color-faint)';
  return (
    <span className={`mono text-[11px] tracking-[0.06em] tabular-nums shrink-0 w-3 ${cls}`}>
      {active ? '›' : ' '}
    </span>
  );
}

function SidebarFooter() {
  return (
    <div className="mt-auto pt-6 border-t border-(--color-rule) mono text-[10px] tracking-[0.12em] text-(--color-faint) leading-[1.7]">
      <div><span className="text-(--color-muted)">last ingest</span> 12 min ago</div>
      <div className="mt-1"><span className="text-(--color-muted)">help</span> · <span>/docs</span></div>
    </div>
  );
}
