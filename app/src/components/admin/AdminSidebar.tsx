// AdminSidebar —— 左侧 6-section nav。当前 active slug 高亮。

import Link from 'next/link';

export type AdminSlug =
  | 'raw' | 'wiki' | 'conversations' | 'codes'
  | 'connectors' | 'page' | 'api-mcp';

interface SectionDef {
  slug: AdminSlug;
  label: string;
  hint: string;
}

const SECTIONS: SectionDef[] = [
  { slug: 'raw',           label: 'raw',           hint: 'AI-pushed dumps' },
  { slug: 'wiki',          label: 'wiki',          hint: 'curated entries' },
  { slug: 'conversations', label: 'conversations', hint: 'visitor sessions' },
  { slug: 'codes',         label: 'codes',         hint: 'access codes' },
  { slug: 'connectors',    label: 'connectors',    hint: 'external sources' },
  { slug: 'page',          label: 'page',          hint: 'edit public page' },
  { slug: 'api-mcp',       label: 'api · mcp',     hint: 'tokens + MCP url' },
];

type Props = {
  active: AdminSlug;
  handle: string;
};

export function AdminSidebar({ active, handle }: Props) {
  return (
    <nav className="border-r border-(--color-rule) px-6 py-10 sticky top-0 h-screen overflow-y-auto">
      <SidebarHeader handle={handle} />
      <ul className="space-y-3">
        {SECTIONS.map((s) => <SidebarItem key={s.slug} section={s} active={s.slug === active} />)}
      </ul>
    </nav>
  );
}

function SidebarHeader({ handle }: { handle: string }) {
  return (
    <header className="mb-8">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">
        standmeet · admin
      </div>
      <div className="mono text-sm mt-2">{handle}</div>
    </header>
  );
}

function SidebarItem({ section, active }: { section: SectionDef; active: boolean }) {
  return (
    <li>
      <Link
        href={`/admin/${section.slug}`}
        data-testid={`nav-${section.slug}`}
        className={`block ${active ? 'text-(--color-accent)' : 'text-(--color-ink) hover:text-(--color-accent)'}`}
      >
        <div className="reading text-base">{section.label}</div>
        <div className="mono text-[10px] tracking-[0.04em] text-(--color-muted)">{section.hint}</div>
      </Link>
    </li>
  );
}
