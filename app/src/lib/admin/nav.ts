// nav —— every admin section's identity (its slug + which group it sits in), written once here.
//
// The display NAME is deliberately NOT here: it lives in the message catalog
// (adminNav.section.<slug> / adminNav.group.<id>). The sidebar label and the big heading behind the
// door both read it through t(), so they stay translated and can never disagree (F-N-3 — one source,
// resolved the same way in both places). nav.ts carries structure, never display strings: there is
// nothing here to forget to translate, which is exactly why the untranslated sidebar happened when
// the names lived here as literals.

export type AdminSlug =
  | 'raw' | 'wiki' | 'subjectivity' | 'output' | 'conversations' | 'codes' | 'requests'
  | 'suppliers' | 'microsites' | 'api-mcp' | 'account'
  | 'skills' | 'writings' | 'drafts' | 'applications'
  | 'dashboard' | 'sources' | 'listings' | 'system'
  | 'preview' | 'obsidian' | 'embeds' | 'assets' | 'data'
  | 'roles' | 'prompts' | 'ip-bans' | 'monitor';

export type NavGroupID =
  | 'overview' | 'corpus' | 'access' | 'resources' | 'jobs' | 'integrations' | 'settings';

export interface SectionDef {
  slug: AdminSlug;
  badgeTestId?: string;
}

export interface NavGroup {
  id: NavGroupID;
  items: readonly SectionDef[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'overview', items: [{ slug: 'dashboard' }] },
  {
    id: 'corpus',
    items: [
      { slug: 'raw', badgeTestId: 'badge-raw' },
      { slug: 'wiki' },
      // subjectivity is read-only: its write path is MCP (the self-model is written while thinking
      // out loud, not filled in through a form). This entry exists for "visible + attachable".
      { slug: 'subjectivity' },
      { slug: 'writings' },
      { slug: 'output' },
    ],
  },
  {
    id: 'access',
    items: [
      { slug: 'conversations' },
      { slug: 'codes' },
      { slug: 'roles' },
      { slug: 'prompts' },
      { slug: 'requests', badgeTestId: 'badge-requests' },
      // embeds belongs under access: an embed exposes a code as a <standmeet-chat> widget on someone
      // else's site — its neighbor is the code it's attached to, not the corpus.
      { slug: 'embeds' },
      { slug: 'preview' },
    ],
  },
  {
    // resources —— what an owner hosts on the instance: their microsites (pages a visitor lands on),
    // the global asset pool those pages + corpus draw from, and the per-microsite data stores.
    id: 'resources',
    items: [{ slug: 'microsites' }, { slug: 'assets' }, { slug: 'data' }],
  },
  {
    id: 'jobs',
    items: [
      { slug: 'sources' },
      { slug: 'listings', badgeTestId: 'badge-listings' },
      { slug: 'drafts' },
      { slug: 'applications' },
      { slug: 'skills' },
    ],
  },
  {
    id: 'integrations',
    items: [{ slug: 'suppliers' }, { slug: 'api-mcp' }, { slug: 'obsidian' }],
  },
  {
    id: 'settings',
    // monitor sits first: it is the only section here an owner opens out of curiosity rather
    // than to change something, and it answers the question the others cannot — did anyone come.
    items: [{ slug: 'monitor' }, { slug: 'ip-bans' }, { slug: 'account' }, { slug: 'system' }],
  },
];

// ADMIN_SLUGS —— the slugs the sidebar renders, computed from NAV_GROUPS (one source; adding a
// section here makes the path→section mapping recognize it automatically — F-N-1).
export const ADMIN_SLUGS: readonly AdminSlug[] =
  NAV_GROUPS.flatMap((g) => g.items.map((i) => i.slug));

// navMessageKey / groupMessageKey —— the catalog key (within the `adminNav` namespace) a section /
// group resolves its display name from. Kept next to the slugs the keys are built from, so a new
// section's key shape is obvious. Dynamic in t(), so check-i18n-keys enforces them via locale
// parity (every locale mirrors en) rather than per-call resolution.
export function navMessageKey(slug: AdminSlug): string {
  return `section.${slug}`;
}
export function groupMessageKey(id: NavGroupID): string {
  return `group.${id}`;
}
