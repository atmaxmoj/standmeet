# StandMeet — Features & User Journeys

> This document is the source of the test backlog. First enumerate features and journeys, then add tests based on them.
> Each case / journey is tagged [✓ spec] when covered, [~ spec] when partly covered, [ ] when not covered.
> Maintenance rule: changed a product surface → update this file in the same change; wrote a new e2e → flip [ ] to [✓ spec-name].

---

## 1. Feature inventory (by surface)

### 1.1 Public page surfaces

#### `/` — Owner public page (single-owner v1)

**Long-scroll mode** (public visitor, no session):
- TopBar: handle / dark toggle [✓ public-page]
- Hero (identity strip + serif prose + chat input dock + examples) [✓ public-page]
- QuickAskDeck (with ≥6 examples, renders a 3-col numbered question grid; asked ones get line-through) [✓ public-page]
- Quota lockdown (used >= max → input disabled + "session full · request more") [✓ session-strip]
- `?q=` URL consumption (arriving from blog AskAboutThis / a starter feeds the chat automatically) [✓ ask-about-this]
- Conversation Deck (multi-turn history + reset + citations + ToolCallBlock) [✓ visitor-chat-*]
- Insights (owner's recent wiki/output cards, expandable body) [✓ public-page]
- Projects (curated work samples, typography only) [✓ page-edit-full]
- Where (looking-for status + filter list) [✓ page-edit-full]
- Contact (email / jump-to-chat / recruiter rules / casual rules) [✓ page-edit-full]
- Footer (entries count + updated + grounded retrieval hint) [✓ public-page]

**ChatRoom mode** (coded / BYOAI visitor, with a session):
- SessionStrip (sticky top bar: code label + gauge + BYOAI violet + warn + exit) [✓ session-strip]
- VisitorNamePicker modal (asks for a name on first chat, 30d dismiss) [✓ visitor-name-picker]
- ChatRoom slim header (standmeet / handle / live dot + reset + "full page →") [✓ gate-access, byoai-chat]
- ChatWelcome (coded: "Hi, {name}. Scoped to {label}." / BYOAI: "public slice only") [✓ gate-access, byoai-chat]
- ChatComposer (sticky bottom input + starter chips + ask ↵ / session full) [✓ gate-access, byoai-chat]
- ChatTranscript (Turn: question + AI answer + ToolCallBlock) [✓ byoai-chat]
- ChatFootnote ("how this works" explainer) [✓ byoai-chat]
- ToolCallBlock (calendar slots / booking / image / file structured renders) [✓ built-in]

#### `/gate` — three-tier entry panel
- Code panel (enter code + visitor name → POST /v1/sessions) [✓ access-codes, gate-access]
  - v5 polish: uppercase normalization + auto-submit on paste + shake on wrong code + "checking…" / "unknown code" states [✓ gate-access]
  - session response returns members[] + code_label (added in the backend) [✓ built-in]
- BYOAI panel (provider preset + endpoint + model + key, all 4 required) [✓ byoai-chat]
- Request access form (email / name / org / message) [✓ gate-access]
- "what's behind" explainer section [✓ gate-access]

#### `/blog` — Blog index
- Cover card grid (amber / violet / acid hue + headline + excerpt + tags) [✓ blog-posts]
- Tag filter chips [✓ blog-posts]
- Infinite scroll (12/page, cursor paging) [✓ blog-posts]
- "or skip the reading · Ask the AI directly" CTA (end of page, jumps to / chat) [✓ ask-about-this]
- RecommendedRail ("if you only read two" + top 2 recommended posts) [✓ built-in]
- SessionStrip [✓ session-strip]
- FloatingChatDock (floating chat panel at the bottom right, chat without leaving the page) [✓ built-in]

#### `/blog/<slug>` — Blog article
- Cover section [✓ blog-posts]
- ArticleHeader (title + meta + tags) [✓ blog-posts]
- GFM body rendering (h2/h3/bold/italic/list/table/code/quote/img/checklist) [✓ blog-posts]
- Inline images (`standmeet-asset:<id>` → backend-signed `/api/v1/assets/{id}` URL, served from the internal minio) [✓ blog-posts]
- `[[crosslink]]` render-time rewrite [✓ blog-crosslinks]
- Backlinks aside ("linked from") [✓ blog-crosslinks]
- AskAboutThis (end-of-article follow-up input bar + starter prompts → `/?q=...`) [✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [✓ built-in]
- LockedView (private post + no code → teaser + request CTA) [ ]
- XSS escape [✓ blog-posts]

#### `/wiki/<slug>` — Wiki SEO landing
- SEO og tags + canonical [✓ wiki-landing]
- Cover hero (typographic OG-style header) [✓ built-in]
- Body rendering (plain text + links) [✓ wiki-landing]
- Breadcrumb (writing / wiki · slug) [✓ wiki-landing]
- TrustBox (about this entry) [✓ wiki-landing]
- AskAboutThis (kind=wiki) [✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [✓ built-in]
- LockedView (private entry → "requires an access code" + gate link) [✓ built-in]

#### `/output/<slug>` — Output SEO landing
- Cover hero (typographic + format tag) [✓ built-in]
- PDF preview card (8.5×11 aspect-ratio placeholder) [✓ built-in]
- Breadcrumb (writing / output · slug) [✓ output-landing]
- TrustBox (about this piece) [✓ output-landing]
- AskAboutThis (kind=output) [✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [✓ built-in]
- LockedView (gated output → "requires an access code") [✓ built-in]

#### `/p/<slug>` — Custom React page (written by the owner, SDK embedded)
- Vite-built React page [✓ microsite]
- Static assets served directly [✓ microsite]
- Rollback to the previous build [ ]

### 1.2 Auth + setup surfaces

#### `/setup?t=<token>` — first-run claim (4-step wizard)
- Step 1 Identity: name / handle / publicUrl [✓ claim-instance, setup-wizard-4step]
- Step 2 Credentials: email / password / confirm [✓ claim-instance, setup-wizard-4step]
- Step 3 AI Provider: provider chip + key + model (skippable) [✓ setup-wizard-4step]
- Step 4 Verify: arithmetic captcha + summary card → submit [✓ setup-wizard-4step]
- Step progress bar (4 segments + labels) [✓ setup-wizard-4step]
- PrimaryBtn realtime disable (required fields of the step not filled → button greyed out) [✓ setup-wizard-4step]
- Wrong captcha rejected [✓ setup-wizard-4step]
- Password mismatch error [✓ setup-wizard-4step]

#### `/login` — Owner login
- Email + password [✓ owner-login]
- Turnstile captcha (toggle on) [ ]
- "forgot password" link [✓ password-reset]
- Throttle on failed logins [ ]

#### `/account/reset?t=<token>` — Password reset
- Enter new password → reset [✓ password-reset]

### 1.3 Admin backend (`/admin`)

#### Sidebar
- 6-group NAV_GROUPS (overview / corpus / access / jobs / integrations / settings) [✓ admin-auth-guards]
- mono 11.5px nav-links + "── group" headers + border-left accent active [✓ admin-auth-guards]
- Dynamic badges (raw unprocessed / requests new / listings shortlist) [✓ built-in]
- testid-based nav links (admin-nav-<slug>) [✓ admin-auth-guards]

#### Dashboard (/admin/dashboard)
- 4 KPI cards with trend arrows [✓ admin-auth-guards]
- Corpus pulse SVG sparkline (14d) [✓ built-in]
- Jobs heat card (shortlist / sent / top match) [✓ built-in]
- Recent visitors table (top 5 conversations with name / code / turns / priv hits) [✓ built-in]
- "needs your hand" action list (requests + raw + resume drafts pending) [✓ built-in]

#### Raw
- list + 4-tab status filter (all/unprocessed/flagged-private/promoted) [✓ corpus-crud-ui]
- DumpBox (source picker chips + textarea + "attach media" button) [✓ built-in]
- Per-row media metadata (kind · label) [✓ built-in]
- Edit body / tags / source / private-hint [✓ corpus-crud-ui]
- delete / archive [✓ corpus-crud-ui]
- promote_to_wiki modal [✓ corpus-curation]

#### Wiki
- tag-chip filter row + 2-col grid card [✓ corpus-crud-ui]
- excerpt paragraph (backend takes the first 200 characters of Body) [✓ built-in]
- ● public/private visibility dot [✓ built-in]
- create / edit / delete [✓ corpus-crud-ui]
- SEO editing (seo_slug / seo_description / indexed / og_image) [~ seo-feeds]
- promote_to_output [✓ output-promotion]
- view live ↗ link [✓ wiki-landing]

#### Outputs
- 2-col card grid (cover strip with hue gradient + tier pill + format tag) [✓ output-promotion]
- views / downloads stats row [✓ built-in]
- dual create buttons (+ pdf lead-magnet / + web essay) [✓ built-in]
- create / edit / delete [✓ output-promotion]
- tier derivation (seo_indexed + show_as_source → public/unlisted/private) [✓ built-in]

#### Conversations
- table (visitor / via code / turns / sentiment / flags / last) [✓ conversations-per-code]
- sentiment column (backend DeriveSentiment heuristic: engaged/warm/curious/short/probing/shopping) [✓ built-in]
- private-hits flag column [✓ built-in]
- transcript expand + cited bodies [✓ conversations-per-code]

#### Codes
- create modal (label / corpus_permissions / quotas / suggested_questions / skills) [✓ access-codes, code-quotas]
- 2-col card grid with 3-col body layout (members | scope | inline QR) [✓ access-codes]
- Quota visual bar [✓ built-in]
- "M active · N total" count [✓ access-codes]
- members column (who has used it) [✓ member-quotas]

#### Access Requests
- list + filter chips (open / replied / closed / all) [✓ gate-access]
- blockquote message display [✓ built-in]
- approve · issue code → / decline politely / defer · pending / block sender buttons [✓ built-in]

#### Drafts (/admin/drafts)
- GET /api/admin/drafts/ real fetch [✓ drafts-composer]
- draft card (2-col: content + 200px PDF preview thumbnail) [✓ built-in]
- status Pill (reviewing / draft / sent) [✓ built-in]
- diff-vs-master quote block (accent left border) [✓ built-in]
- action buttons vary by status [✓ built-in]
- "open composer →" → ResumeComposer full-screen overlay [✓ built-in]

#### Applications (/admin/applications)
- GET /api/admin/applications/ real fetch [✓ applications-detail-modal]
- application card with 3-col footer (contact / notes / "open ›") [✓ built-in]
- ApplicationDetailModal (timeline + contact + notes + snapshot + status segmented) [✓ built-in]

#### Connectors
- 2-col grid + dashed "＋ browse the catalog" placeholder card [✓ connector-add-modal]
- ConnectorAddModal (5 category tabs + 18 entry catalog grid) [✓ connector-add-modal]
- ConnectorConfigForm (renders string/select/secret/oauth dynamically from fields[]) [✓ connector-add-modal]

#### API · MCP
- AI provider config [✓ ai-provider-config]
- API token CRUD + MaskedSecret [✓ api-tokens]
- MCP setup tabs (Claude Desktop / Cursor / HTTP with code snippets) [✓ api-tokens]
- MCP install packages grid (npm / macOS / Linux / Windows) [✓ api-tokens]
- External MCP server CRUD + test [✓ external-mcp-tools]

#### Posts / Writing (blog admin)
- inline split-pane editor (1.6fr editor + 1fr EditorSideRail) when editing [✓ blog-posts]
- Tiptap editor + slash menu [✓ blog-posts]
- `[[crosslink]]` autocomplete (CrosslinkCommand + CrosslinkPicker) [✓ built-in]
- EditorSideRail (crosslinks panel + keyboard shortcuts card) [✓ built-in]
- cover headline / sub / hue / cover image upload [✓ blog-posts]
- paste image → MinIO upload [✓ blog-posts]
- "N posts · M drafts" count [✓ built-in]
- edit existing post [✓ blog-posts]

#### Microsites
- table view (page / template / visibility / views / updated / actions) [✓ microsite]
- "+ new page" header action [✓ built-in]
- "templates available" 4-cell grid (press-kit / list-with-prose / menu / auto-now) [✓ microsite]
- editor + build [✓ microsite]
- staging preview → promote live [✓ microsite]
- rollback [ ]

#### Skills
- corpus-inferred heat graph (2-col grid, heat-bar gradient + role labels: core/strong/maintained/developing/dormant) [✓ built-in]
- "rebuild from corpus" button [✓ built-in]
- AI-persona skill CRUD cards (name + prompt + scripts) [✓ skills]
- bind to a code [✓ skills]

#### Preview (/admin/preview)
- code picker sidebar (one card per code + BYOAI card) [✓ built-in]
- simulated visitor view (banner + welcome prose + suggested questions) [✓ built-in]

#### Sources (/admin/sources)
- intro + empty state [✓ built-in]
- table with full data rows (needs an admin REST endpoint wired up later) [ ]

#### Listings (/admin/listings)
- intro + empty state [✓ built-in]
- table + match-bar + filter tabs (needs an admin REST endpoint wired up later) [ ]

#### Page customization (/admin/page)
- 7 block rows (hero / insights / projects / where / contact / site / byoai) [✓ page-edit-full]
- handle editing [✓ page-edit, public-url-edit]
- Save / dirty state [✓ page-edit]

#### Account
- 4-card grid (profile + security + inference + data/backups) [✓ account-edit]
- profile: full name + email editing [✓ account-edit]
- security: password change + 2FA/recovery phrase placeholders [✓ built-in]
- inference: provider + 30d spend [✓ built-in]
- data: storage + backup now + export corpus [✓ built-in]

#### SEO (per-microsite, no separate admin section)
- Each microsite sets its own `seo_title` / `seo_description` / `seo_image` in its editing flow (`microsite.set_seo`) [✓ built-in]
- Injected into the served page's `<head>`: title + meta description + Open Graph (og:title/og:description/og:image) + Twitter card [✓ built-in]
- Site default SEO = the homepage microsite's own per-page SEO; there is no instance-level global setting [✓ built-in]
- Live microsites go into the dynamic `/sitemap.xml` (`/p/<slug>`) [✓ built-in]

#### Obsidian (/admin/obsidian)
- vault stats (mode / notes / size / last sync) [✓ built-in]
- import / export actions [✓ obsidian-sync]
- recent events log [✓ built-in]

#### System (/admin/system)
- terminal deployment block (version / node / uptime / migrations) [✓ built-in]
- resources KPIs (cpu / memory) [✓ built-in]
- background jobs table [✓ built-in]
- health checks grid (status dots + details) [✓ built-in]

### 1.4 MCP server tools

#### Corpus
- raw_dump / list_recent_raw / promote_to_wiki / list_recent_wiki [~ corpus-curation]

#### Posts
- post_create [✓ blog-posts]
- post_list / post_publish / post_delete [~ blog-crosslinks]

#### Wiki / Output / SEO
- promote_wiki_to_output / list_output [✓ output-promotion]
- set_wiki_slug / seo.set_entry_seo (per-entry publish + excerpt) / microsite.set_seo (per-microsite) [~ seo-feeds]

#### Skills
- skill_create / skill_list / skill_delete [✓ skills]

#### Jobs (left half of the outbound loop)
- jobs.register_source / list_sources / unregister_source [✓ job-sources-register]
- jobs.fetch_new (8 adapters) [✓ job-fetch-multi-source]
- jobs.show / discard [✓ job-discard]
- TTL eviction [✓ job-fetch-ttl-eviction]
- Dedup [✓ job-fetch-deduplicates]

#### Resume + applications
- resume.draft / update_draft / discard_draft [✓ resume-draft-preview, resume-draft-update, resume-draft-discard, resume-draft-ttl]
- applications.commit (write row + auto AccessCode + render PDF + QR) [✓ applications-commit, applications-commit-qr-works, applications-commit-playwright-hint]

#### Microsites
- create / list / delete / write_file / build_page / get_build / promote / rollback [✓ mcp-page-lifecycle]

#### MCP servers
- mcp_server.create / list / delete [✓ external-mcp-tools]

#### Debug / metadata
- chat.show_grounding [✓ mcp-show-grounding]
- me [ ]

#### MCP auth
- bearer token gating (owner / job / skill) [✓ mcp-auth, mcp-jobs-auth]

### 1.5 Inference / chat engine
- SSE streaming [✓ visitor-chat-*]
- Source citation (wiki / output citation reveal) [✓ visitor-chat-cited-precise, visitor-chat-cites-output, visitor-chat-hidden-source]
- corpus_permissions ACL (allow / deny first-match-wins) [✓ visitor-chat-permissions-deny]
- BYOAI public-slice restriction [✓ visitor-chat-byoai-public-only]
- visitor summary [✓ visitor-summary]
- ToolCallBlock structured rendering (calendar / booking / image / file) [✓ built-in]
- tier-switch fallback (code exhausted → public) [ ]

### 1.6 Quota system
- per-code max_sessions / max_turns_per_session / TTL [✓ code-quotas, turn-quota, quota-accumulation]
- per-member quota [✓ member-quotas]
- exceeded → reject + SessionStrip warn + AskInput/ChatComposer lockdown [✓ code-quotas, session-strip]
- code self-test (owner previews the visitor experience) [✓ code-self-test]

### 1.7 Asset management
- MinIO blob lifecycle (CREATE = tx commit → upload; DELETE = list + delete blobs) [~ blog-posts]
- presigned URL [✓ blog-posts]
- holder_id NOT NULL (no orphan) [ ]
- orphan sweep (still runs even if orphans exist) [ ]

### 1.8 SEO + feeds
- robots.txt + sitemap.xml [✓ seo-feeds]
- og: tags (root / blog / wiki / output) [~ seo-feeds]
- canonical URL [ ]
- RSS feed (blog posts) [ ]

### 1.9 Visitor session
- session stored in localStorage (standmeet-session via zustand store) [✓ qr-code-absorb, session-strip]
- SessionStrip (cross-surface sticky top bar + gauge + warn) [✓ session-strip]
- ChatRoom (automatic switch to the focused layout for coded/BYOAI visitors) [✓ gate-access, byoai-chat]
- conversation continuity (same visitor, same session) [✓ visitor-chat-*]
- visitor name picker modal on first chat [✓ visitor-name-picker]
- session shared across tabs (cross-tab storage event sync) [✓ session-strip]
- FloatingChatDock (floating chat panel on blog/wiki/output) [✓ built-in]

### 1.10 Design system
- sm-tokens.css (11 colors + serif/mono + tracking + motion) [✓ built-in]
- sm-atoms.css (22+ atom classes: session strip / visitor name picker / crosslink picker / composer / connector modal / floating chat, etc.) [✓ built-in]
- sm-mobile.css (responsive at ≤720/900/1024 breakpoints) [✓ built-in]
- SVG Sparkline component (polyline + area fill) [✓ built-in]
- .shake keyframe (gate wrong-code shake) [✓ gate-access]

### 1.11 System / infra
- sysroutes: TLS ask / builder webhooks / health [ ]
- captcha verifier (Turnstile / noop) [ ]
- reset endpoint (used for e2e teardown) [✓ indirect]

---

## 2. User journeys

### 2.A Owner journeys

| # | Journey | Key steps | Spec coverage |
|---|---|---|---|
| A1 | First deploy + 4-step claim | `docker compose up` → `/setup?t=...` → identity → credentials → AI provider (skippable) → captcha verify → `/admin` | [✓ claim-instance, setup-wizard-4step] |
| A2 | Log in | `/login` → cookie → `/admin` | [✓ owner-login] |
| A3 | Forgot password | `/login` → forgot → email → `/account/reset?t=...` → new password | [✓ password-reset] |
| A4 | Configure server-side AI provider | `/admin/api-mcp` → provider + key → test → save | [✓ ai-provider-config] |
| A5 | Install MCP client + bind Claude Desktop | API token → MCP setup tab → copy snippet → paste to config | [✓ api-tokens] |
| A6 | Feed raw via MCP raw_dump | Claude → raw_dump → visible in `/admin/raw` | [~ corpus-curation] |
| A7 | Promote raw to wiki | MCP promote_to_wiki / admin UI promote modal | [✓ corpus-curation] |
| A8 | Promote wiki to output | promote_wiki_to_output | [✓ output-promotion] |
| A9 | Write a blog post in the admin UI (inline editor + side rail) | new post → inline split-pane editor → / for slash menu → [[ for crosslink → side rail shows crosslinks + keyboard hints | [✓ blog-posts] |
| A10 | Write a blog post via MCP post_create | post_create(GFM markdown, publish=true) | [✓ blog-posts] |
| A11 | publish / unpublish / delete post | admin UI row actions | [ ] |
| A12 | Obsidian vault sync (feed face) | `/admin/obsidian` upload whole vault → `SyncVault`: top-folder→genre routing (wiki/subjectivity/raw/writing) · folder nesting→`parent_id` node tree · folder-note collapse (`foo/foo.md`) · tolerant frontmatter · whole-batch `[[link]]`→`note_refs` · web-wins guard; reverse export→zip | [✓ sync-a-routing · -b-tree · -c-title · -d-publish · -e-links · -f-frontmatter · -g-hidden · -h-reconcile · -i-raw · -j-export] |
| A13 | Change public page blocks | `/admin/page` → hero/projects/where/contact/site/byoai | [✓ page-edit, page-edit-full] |
| A14 | Connect a custom domain | `/admin/page` → domain → CNAME | [ ] |
| A15 | Write a custom React page | microsite.create → write_file → build → promote | [✓ mcp-page-lifecycle, microsite] |
| A16 | Connect an external MCP server | `/admin/api-mcp` MCP servers add | [✓ external-mcp-tools] |
| A17 | Issue an access code by hand | `/admin/codes` new code + quotas + suggested Q | [✓ access-codes, code-quotas] |
| A18 | Approve an access request → auto code | `/admin/requests` → approve · issue code → | [ ] |
| A19 | Browse conversations + sentiment | `/admin/conversations` table with sentiment column + transcript | [✓ conversations-per-code, mcp-show-grounding] |
| A20 | Create skills + heat graph | new skill + heat-bar visualization | [✓ skills, skill-scripts] |
| A21 | Edit account | `/admin/account` → 4-card grid: profile / security / inference / data | [✓ account-edit] |
| A22 | Register a job source | jobs.register_source(kind, config) | [✓ job-sources-register] |
| A23 | Fetch new jobs + dedup + TTL | jobs.fetch_new → Redis 1d pool | [✓ job-fetch-multi-source, -deduplicates, -ttl-eviction] |
| A24 | Start a resume draft + iterate | resume.draft / update_draft / discard_draft | [✓ resume-draft-*] |
| A25 | Submit an application (key step of the loop) | applications.commit → write row + auto code + PDF + QR | [✓ applications-commit, -qr-works, -playwright-hint] |
| A26 | per-microsite SEO + sitemap | set `seo_title` / `seo_description` / `seo_image` in the microsite editor (injected into the served page's `<head>`); site default = homepage microsite; live microsites go into `/sitemap.xml` | [~ seo-feeds] |
| A27 | Add a connector | `/admin/connectors` → dashed "+" card / header button → ConnectorAddModal → category tabs → config form → connect | [✓ connector-add-modal] |
| A28 | View the dashboard | `/admin/dashboard` → 4 KPI + sparkline + jobs heat + recent visitors + needs-your-hand | [✓ admin-auth-guards] |
| A29 | View drafts + open composer | `/admin/drafts` → draft card (PDF preview + status pill + diff) → "open composer →" → 6 panel + preview | [~ drafts-composer] |
| A30 | View applications | `/admin/applications` → card (3-col footer) → detail modal → status / notes | [~ applications-detail-modal] |
| A31 | Preview as visitor | `/admin/preview` → pick code / BYOAI → see simulated visitor view with banner + welcome + suggested questions | [✓ built-in] |
| A32 | View system info | `/admin/system` → terminal deploy block + resources + jobs + health checks | [✓ built-in] |
| A33 | corpus as a living graph (crawl face) | any corpus note → cited-by / related via `corpus_links` (1-hop over `note_refs`, every neighbor re-ACL'd) — the vault's backlink graph, agent-drivable | [✓ retrieval-links] |

### 2.B Visitor journeys

| # | Journey | Key steps | Spec coverage |
|---|---|---|---|
| B1 | Scan a QR (main recruiter entry) | `/?code=ABC` → absorb → URL cleared → ChatRoom (focused layout) | [✓ qr-code-absorb, session-strip] |
| B2 | Enter a code by hand (auto-submit on paste) | `/gate` code panel → paste → shake on error → submit → ChatRoom | [✓ gate-access, access-codes] |
| B3 | BYOAI: set provider+key and chat | `/gate` BYOAI panel → vault encryption → ChatRoom (BYOAI mode) | [✓ byoai-chat, visitor-chat-byoai-public-only, session-strip] |
| B4 | Request access without a code | `/gate` request form | [✓ gate-access] |
| B5 | One ChatRoom chat turn + starter chips | ChatComposer → "try" starter → SSE → Turn with citations | [✓ visitor-chat-cited-precise, -cites-output, -hidden-source] |
| B6 | View the long-scroll (public visitor) | root scroll: Hero → QuickAskDeck → Insights → Projects → Where → Contact → Footer | [✓ public-page] |
| B7 | Browse the blog list + CTA + recommend | `/blog` infinite scroll → CTA → "if you only read two" | [✓ blog-posts, ask-about-this] |
| B8 | Read a public blog post + crosslink + AskAboutThis | `/blog/<slug>` GFM + `[[X]]` + linked-from + end-of-article follow-up | [✓ blog-posts, blog-crosslinks, ask-about-this] |
| B9 | Open a private blog post → LockedView | `/blog/<private>` without a code | [ ] |
| B10 | wiki SEO landing + cover hero + trust box | `/wiki/<slug>` cover hero + breadcrumb + TrustBox + AskAboutThis | [✓ wiki-landing, ask-about-this] |
| B11 | output landing + hero + PDF preview | `/output/<slug>` hero + PDF preview card + TrustBox + AskAboutThis | [✓ output-landing, ask-about-this] |
| B12 | View a microsite | `/p/<slug>` | [✓ microsite] |
| B13 | Quota exhausted lockdown | turns reach the limit → SessionStrip warn → ChatComposer "session full" → "request more ↗" | [~ code-quotas, session-strip] |
| B14 | visitor summary (multi-turn summary) | summary endpoint | [✓ visitor-summary] |
| B15 | Enter a name on first chat | arrive at / via QR → VisitorNamePicker modal → enter name / skip | [✓ visitor-name-picker] |
| B16 | Follow up directly from the end of a blog post | AskAboutThis starter prompt → `/?q=...` → root ChatRoom/long-scroll feeds the chat automatically | [✓ ask-about-this] |
| B17 | Chat on blog/wiki/output without leaving the page | FloatingChatDock pill → expand panel → type → same session | [✓ built-in] |
| B18 | wiki/output private entry → LockedView | visit a private wiki/output without a code → "requires an access code" + gate link | [✓ built-in] |
| B19 | Search the corpus (crawl face) | ChatRoom `CorpusSearchBox` → `corpus_search` (Meili lexical, ACL-gated per hit, Meili down→PG FTS degrade, never 500) → result links / friendly empty | [✓ retrieval-search-box, retrieval-search-consistency, retrieval-acl, retrieval-degrade] |
| B20 | Read an entry with math/diagrams/callouts (render face) | `/wiki\|/output\|/writings/<path>` body renders KaTeX math · Mermaid diagrams · Obsidian callouts · TikZ · owner CSS snippet / per-note cssclasses | [✓ render-callouts, render-tikz, render-widget, render-owner-css, render-cssclasses] |

### 2.C Cross-actor / system journeys

| # | Journey | Key steps | Spec coverage |
|---|---|---|---|
| C1 | Full job loop end to end | A22→A23→A24→A25 → B1 → B5 → A19 | [~ each segment covered; end-to-end chain [ ]] |
| C2 | Owner reads transcripts and backfills the corpus | A19 → A6 → A7 → next visitor hits it | [ ] |
| C3 | Session expired / quota exhausted | turns reach the limit → SessionStrip warn → ChatComposer lockdown → "request more ↗" | [~ code-quotas, session-strip] |
| C4 | instance reset (e2e teardown) | reset endpoint → setup again | [✓ indirect] |
| C5 | Owner changes handle (old URL 301) | A13 change handle → handle_aliases table → old links redirect | [✓ public-url-edit] |
| C6 | BYOAI key invalid → re-enter | chat 4xx → UI prompt → /gate BYOAI | [ ] |
| C7 | Visitor shares a session across tabs | tab A login → tab B storage event → SessionStrip appears in sync | [~ session-strip] |

---

## 3. Gap summary (based on the [ ] / [~] counts above)

Ordered by priority (business risk × frequency):

### P0 — on the main path but untested
- B9 private post LockedView (visitor cannot see it but has a request-access entry)
- A11 post publish / unpublish / delete e2e
- A18 access request approve → auto-issue AccessCode
- C1 job loop end-to-end chain (each segment passes; the whole chain has never been run together)
- C3 the full ChatRoom-side case after quota is exhausted

### P1 — high value but prone to regression
- Custom domain + CNAME flow
- Microsite rollback
- C6 BYOAI key invalid re-prompt
- Login captcha toggle + Turnstile verify path
- Sources / Listings full table (needs an admin REST endpoint)
- MCP `me` tool

### P2 — edge cases + decoration
- Asset orphan sweep
- Canonical URL + RSS feed
- Turnstile captcha on login
- Account revoke all sessions

### P3 — gradual rollout / dev only
- sysroutes (TLS ask / builder webhooks / health)
- reset endpoint explicit case

---

## 4. Maintenance

- New surface / feature → add it to the matching place in §1 + add a journey to §2
- Wrote a new spec → flip [ ] / [~] to [✓ spec-name]
- Removed a feature → strike the entry in the same change + delete the matching spec
- Periodically (at least monthly) run an inventory: compare `ls e2e/test/*.spec.ts` against the §1.x [✓] tags to find drift
