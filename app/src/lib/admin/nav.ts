// nav —— every admin section's **name** is written exactly once, here.
//
// The sidebar's label and the big heading once you've clicked in are saying
// the same thing: what this section is called. They used to be two
// hand-written strings, hence F-N-3: the label had already been changed to
// `landing page` / `custom pages`, while the heading behind the door still
// said `page` / `pages` — the owner **clicks in**, and once they do, the
// biggest word on screen is what they actually read, and that word is
// exactly why the module exists (two names differing by just a plural). The
// other 24 of 26 sections were hand-copied identically, which is exactly the proof it should have been one string all along.
//
// So: `SectionHeader` takes a slug and asks `navLabel` itself. To rename a section, change it here, and both places move together.

export type AdminSlug =
  | 'raw' | 'wiki' | 'subjectivity' | 'output' | 'conversations' | 'codes' | 'requests'
  | 'connectors' | 'page' | 'custom-pages' | 'api-mcp' | 'account'
  | 'skills' | 'writings' | 'drafts' | 'applications'
  | 'dashboard' | 'sources' | 'listings' | 'seo' | 'system'
  | 'preview' | 'obsidian' | 'embeds'
  | 'roles' | 'prompts' | 'ip-bans';

export interface SectionDef {
  slug: AdminSlug;
  label: string;
  badgeTestId?: string;
}

export interface NavGroup {
  label: string;
  items: readonly SectionDef[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'overview',
    items: [{ slug: 'dashboard', label: 'dashboard' }],
  },
  {
    label: 'corpus',
    items: [
      { slug: 'raw', label: 'raw', badgeTestId: 'badge-raw' },
      { slug: 'wiki', label: 'wiki' },
      // subjectivity is read-only: its write path is MCP (the self-model is
      // written while thinking out loud, not filled in through a form).
      // This entry exists for "visible + attachable to the file" — before it, the panel had no interface at all.
      { slug: 'subjectivity', label: 'subjectivity' },
      { slug: 'writings', label: 'writings' },
      { slug: 'output', label: 'outputs' },
    ],
  },
  {
    label: 'access',
    items: [
      { slug: 'conversations', label: 'conversations' },
      { slug: 'codes', label: 'codes' },
      { slug: 'roles', label: 'roles' },
      { slug: 'prompts', label: 'prompts' },
      { slug: 'requests', label: 'requests', badgeTestId: 'badge-requests' },
      // custom pages belongs under access, not corpus: it isn't a layer of
      // the corpus, it's **where a visitor lands**. A custom page can be
      // bound to a code (custom-page-code-binding), and its neighbors are
      // codes and preview, not raw/wiki/output.
      { slug: 'custom-pages', label: 'custom pages' },
      // embeds belongs under access: an embed exposes a code as a
      // <standmeet-chat> widget on someone else's site, and its neighbors
      // are codes (the code it's attached to) and custom-pages, not the corpus.
      { slug: 'embeds', label: 'embeds' },
      { slug: 'preview', label: 'preview' },
    ],
  },
  {
    label: 'jobs',
    items: [
      { slug: 'sources', label: 'sources' },
      { slug: 'listings', label: 'listings', badgeTestId: 'badge-listings' },
      { slug: 'drafts', label: 'drafts' },
      { slug: 'applications', label: 'applications' },
      { slug: 'skills', label: 'skills' },
    ],
  },
  {
    label: 'integrations',
    items: [
      { slug: 'connectors', label: 'connectors' },
      { slug: 'api-mcp', label: 'api · mcp' },
      { slug: 'obsidian', label: 'obsidian' },
    ],
  },
  {
    label: 'settings',
    items: [
      { slug: 'page', label: 'landing page' },
      { slug: 'seo', label: 'seo' },
      { slug: 'ip-bans', label: 'ip bans' },
      { slug: 'account', label: 'account' },
      { slug: 'system', label: 'system' },
    ],
  },
];

// ADMIN_SLUGS —— the slugs the sidebar **actually renders**, computed from
// NAV_GROUPS, not copied separately.
//
// F-N-1: `AdminShell` used to maintain a second `KNOWN_SLUGS` on its own to
// map a path to "the current section", and that copy was missing
// `subjectivity` — so `/admin/subjectivity` fell through the "unknown →
// dashboard" default, and the sidebar highlighted dashboard. The sidebar
// could render this section, but the path mapping didn't recognize it: **one
// fact, stored twice**. Now there's only NAV_GROUPS; adding a section is automatically recognized.
export const ADMIN_SLUGS: readonly AdminSlug[] =
  NAV_GROUPS.flatMap((g) => g.items.map((i) => i.slug));

// navLabel —— what this section is called. Both the sidebar's label and this section's heading ask it.
export function navLabel(slug: AdminSlug): string {
  const found = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.slug === slug);
  // The type system can't reach here; if it ever does, print the slug — better than silently showing an empty title.
  return found?.label ?? slug;
}
