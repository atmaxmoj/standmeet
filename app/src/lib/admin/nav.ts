// nav —— admin 每一节的**名字**只在这里写一次。
//
// 侧栏那块牌子和点进去之后的大标题，说的是同一件事：这一节叫什么。以前它们是两份手写的字符串，
// 于是 F-N-3：牌子早就改成了 `landing page` / `custom pages`，而门后的标题还是 `page` / `pages` ——
// owner 是**点进去**的，点完之后屏幕上最大的那个词才是他读到的东西，而那个词恰好是这个模块
// 存在的理由（两个只差一个复数的名字）。26 节里另外 24 节手抄得一模一样，正好说明它本来就该是一份。
//
// 所以：`SectionHeader` 收 slug、自己去问 `navLabel`。想改一节的名字，改这里，两处一起动。

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
      // subjectivity 只读:它的写口是 MCP(自我模型是边想边写出来的,不是填出来的)。
      // 有这一条是为了"看得见 + 挂得上文件" —— 在它之前面板上一个界面都没有。
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
      // custom pages 归 access,不归 corpus:它不是语料的一层,它是**访客落到哪儿**。
      // 一个 custom page 可以绑到某个 code 上(custom-page-code-binding),
      // 跟它做邻居的是 codes 和 preview,不是 raw/wiki/output。
      { slug: 'custom-pages', label: 'custom pages' },
      // embeds 归 access:一个 embed 把某张码作为 <standmeet-chat> widget 暴露到别人网站上,
      // 邻居是 codes(它挂的码)和 custom-pages,不是语料。
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

// ADMIN_SLUGS —— 侧栏**渲染出来的**那些 slug，从 NAV_GROUPS 算，不另抄一份。
//
// F-N-1：`AdminShell` 曾自己维护第二份 `KNOWN_SLUGS` 用来把路径映射成"当前节"，
// 而那份漏了 `subjectivity` —— 于是 `/admin/subjectivity` 走「未知 → dashboard」的兜底，
// 侧栏高亮的是 dashboard。侧栏渲得出这一节，路径映射却不认识它：**同一份事实两份存**。
// 现在只有 NAV_GROUPS 一份，加一节就自动被认识。
export const ADMIN_SLUGS: readonly AdminSlug[] =
  NAV_GROUPS.flatMap((g) => g.items.map((i) => i.slug));

// navLabel —— 这一节叫什么。侧栏的牌子和这一节的大标题都问它。
export function navLabel(slug: AdminSlug): string {
  const found = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.slug === slug);
  // 类型上到不了这里；真到了就把 slug 印出来，好过静默显示空标题。
  return found?.label ?? slug;
}
