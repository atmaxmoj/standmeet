-- corpus_notes.sql —— 统一 note 基座的 query。wiki + output 两个 genre 共用这一套（genre 作参数）：
-- 原 wiki 的 13 条 + output 的 11 条近重复 query 收成这 12 条。Repo 层各自绑定自己的 genre 调用。
-- 地址仍纯树派生（parent 链），本表不存 path 列。

-- name: CreateNote :one
INSERT INTO corpus_notes (owner_id, genre, parent_id, title, body, tags, source_ids, css_classes, show_as_source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListNotesByOwner :many
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
ORDER BY created_at DESC
LIMIT $3;

-- name: GetNoteByID :one
SELECT * FROM corpus_notes WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: DeleteNote :exec
DELETE FROM corpus_notes WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: SetNoteTags :exec
UPDATE corpus_notes SET tags = $4, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: UpdateNoteBody :one
-- admin "edit" 入口：改 title/body/tags/parent_id/show_as_source。excerpt/published 走 UpdateNoteSEO。
UPDATE corpus_notes
SET title = $4, body = $5, tags = $6, parent_id = $7, show_as_source = $8, css_classes = $9, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = $3
RETURNING *;

-- name: UpdateNoteSEO :one
-- 编辑 SEO 描述 + published 开关（地址树派生，owner 不自设 path）。owner_id 必带：
-- 多租户下没有它就是 BOLA（按 id 改到别的 owner 的 note）——与所有 corpus_notes mutation 一致。
UPDATE corpus_notes
SET excerpt = $2, published = $3, updated_at = now()
WHERE id = $1 AND genre = $4 AND owner_id = $5
RETURNING *;

-- name: ListNoteChildren :many
-- 懒加载一层：某节点的直接子（meta only，不带 body）；$3 NULL = 根层。has_children 判还能否下钻。
SELECT n.id, n.parent_id, n.title, n.published,
       EXISTS(SELECT 1 FROM corpus_notes c WHERE c.parent_id = n.id AND c.genre = $2) AS has_children
FROM corpus_notes n
WHERE n.owner_id = $1 AND n.genre = $2
  AND (($3::uuid IS NULL AND n.parent_id IS NULL) OR n.parent_id = $3)
ORDER BY n.title ASC
LIMIT $4 OFFSET $5;

-- name: ListNoteChildrenAdmin :many
-- Admin lazy tree layer: one parent's direct children as FULL rows (body/tags/excerpt/…) +
-- has_children (can drill down) + path_titles (root→leaf, for the server-slugified "view live"
-- address). Owner-scoped, NO ACL cascade — the owner sees every status (unlike the public
-- label-only ListNoteChildren). $3 NULL = root layer. Siblings of one parent, so no cap.
WITH RECURSIVE up AS (
  SELECT c.id AS leaf_id, c.id, c.parent_id, ARRAY[c.title]::text[] AS path_titles
  FROM corpus_notes c
  WHERE c.owner_id = $1 AND c.genre = $2
    AND (($3::uuid IS NULL AND c.parent_id IS NULL) OR c.parent_id = $3)
  UNION ALL
  SELECT up.leaf_id, p.id, p.parent_id, p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT sqlc.embed(n),
       EXISTS(SELECT 1 FROM corpus_notes ch WHERE ch.parent_id = n.id AND ch.genre = $2) AS has_children,
       (SELECT u.path_titles FROM up u WHERE u.leaf_id = n.id AND u.parent_id IS NULL LIMIT 1) AS path_titles
FROM corpus_notes n
WHERE n.owner_id = $1 AND n.genre = $2
  AND (($3::uuid IS NULL AND n.parent_id IS NULL) OR n.parent_id = $3)
ORDER BY n.title ASC;

-- name: ListDistinctTagsByGenre :many
-- 一个 genre 里出现过的**全部**标签,去重排序。给面板的标签行用。
-- 它必须是语料级的:标签行以前从「已加载的那一页」推,于是只存在于那一页之外的标签**连
-- chip 都没有** —— 点不到,也就无从发现自己漏了什么(F-L-23 的后半条)。
SELECT DISTINCT unnest(tags)::text AS tag
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
ORDER BY 1;

-- name: ListNotesByOwnerPage :many
-- Grid pagination (infinite scroll): keyset on (created_at DESC, id DESC). $3/$4 = the
-- last row's (created_at, id) cursor — both NULL = first page. Composite tiebreak because
-- a vault sync batch can share created_at. LIMIT $5 (+1 caller-side → has_more). Full row
-- via sqlc.embed + path_titles so the server slugifies the address even on a partial page.
--
-- $6 = tag filter ('' / NULL = no filter). It has to live HERE, next to the ORDER BY and the
-- LIMIT, because the page is what the cursor walks: filtering client-side after the fact means
-- the filter only ever sees one page, which is how the panel came to report 1 math note against
-- a corpus holding 137 (F-L-23). The recursive CTE stays unfiltered on purpose — it only exists
-- to resolve each returned row's ancestor titles, and narrowing it would not change any answer.
WITH RECURSIVE up AS (
  SELECT c.id AS leaf_id, c.id, c.parent_id, ARRAY[c.title]::text[] AS path_titles
  FROM corpus_notes c
  WHERE c.owner_id = $1 AND c.genre = $2
    AND ($3::timestamptz IS NULL OR (c.created_at, c.id) < ($3::timestamptz, $4::uuid))
  UNION ALL
  SELECT up.leaf_id, p.id, p.parent_id, p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT sqlc.embed(n),
       (SELECT u.path_titles FROM up u WHERE u.leaf_id = n.id AND u.parent_id IS NULL LIMIT 1) AS path_titles
FROM corpus_notes n
WHERE n.owner_id = $1 AND n.genre = $2
  AND ($3::timestamptz IS NULL OR (n.created_at, n.id) < ($3::timestamptz, $4::uuid))
  AND ($6::text IS NULL OR $6::text = '' OR $6::text = ANY(n.tags))
ORDER BY n.created_at DESC, n.id DESC
LIMIT $5;

-- name: CountNoteDescendants :one
-- Exact recursive descendant count for one node — the delete-cascade warning
-- ("also deletes its N child entries"). On-demand (one user action), not per level.
WITH RECURSIVE sub AS (
  SELECT cn.id FROM corpus_notes cn
  WHERE cn.parent_id = $2 AND cn.owner_id = $1 AND cn.genre = $3
  UNION ALL
  SELECT n.id FROM corpus_notes n JOIN sub ON n.parent_id = sub.id
)
SELECT count(*) FROM sub;

-- name: GetNoteMetaByID :one
-- meta only（无 body）：上溯算树派生 path / 判 ACL 用，不为读正文。
SELECT id, parent_id, title, published
FROM corpus_notes
WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: ListNoteCardsByIDs :many
-- Page-pin join:被 pin 的条目 → 卡内容(title + excerpt + published 兜底过滤)。
-- 顺序由 caller 按 pin 列表重排,这里不 ORDER。
SELECT id, title, excerpt, published
FROM corpus_notes
WHERE owner_id = $1 AND id = ANY($2::uuid[]);

-- name: CountNoteStats :one
-- 侧栏脚定位计数：总条数 / 根条数 / 非公开（gated）条数。纯聚合，不 load 树。
SELECT
  count(*) AS entries,
  count(*) FILTER (WHERE parent_id IS NULL) AS roots,
  count(*) FILTER (WHERE NOT published) AS gated
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2;

-- name: ListAllNoteMeta :many
-- 全量 meta（无 body、无 limit）：sitemap 枚举 + landing 的 title→path 索引用。不带 newest-N cap
-- —— sitemap / 链接解析必须看全量，漏一条就是 SEO bug / 断链。带 updated_at 给 sitemap <lastmod>。
SELECT id, parent_id, title, published, updated_at
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
ORDER BY created_at DESC;

-- name: ListAllOwnerNoteTitles :many
-- 跨-genre 的 title→id 索引：`[[Title]]` 可指向 owner 语料里任一 genre 的任一条。给 note refs
-- 解析用（wiki body 里 [[Output Title]] 也要解析得到边）。全量、无 cap —— 漏一条就是断链。
-- aliases 一起取：`[[别名]]` 也要解析得到边，别名跟 title 是同一批候选（消歧同一套规则）。
SELECT id, title, genre, aliases FROM corpus_notes WHERE owner_id = $1;

-- name: QueryCorpusNotes :many
-- 原生 standmeet-query 用:按 genre/tag 过滤(空串 = 不筛),并沿 parent 链在 SQL 里算出 path_titles
-- (root→leaf),省掉逐条 N+1 的 path walk。只返 root-reached 行(每个匹配条一行,带完整 path)。
-- leaf_published 跟着叶子往上传:准入要问「这条自己发布了吗」(public 身份唯一的判据),
-- 而 path walk 走到 root 时叶子的行已经不在手里了。
WITH RECURSIVE up AS (
  SELECT n.id AS leaf_id, n.genre AS leaf_genre, n.published AS leaf_published,
         n.id, n.parent_id,
         ARRAY[n.title]::text[] AS path_titles
  FROM corpus_notes n
  WHERE n.owner_id = $1
    AND ($2::text = '' OR n.genre = $2::text)
    AND ($3::text = '' OR $3::text = ANY(n.tags))
  UNION ALL
  SELECT up.leaf_id, up.leaf_genre, up.leaf_published, p.id, p.parent_id,
         p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT up.leaf_id AS id, up.leaf_genre AS genre, up.leaf_published AS published,
       up.path_titles
FROM up WHERE up.parent_id IS NULL;

-- name: GrepCorpusNotes :many
-- corpus_grep 的扫描面:owner 的每一条 note,连正文,path 沿 parent 链在 SQL 里算好。
--
-- **没有 LIMIT,也不会有。** never-miss 是这个工具存在的理由:模式在的地方必然被返回。
-- 一个 cap 会让它退化成"通常能找到",而那正是隔壁 corpus_search 已经提供的东西。
-- 正文里匹配与否在 Go 那侧判(RE2,跟 owner 写的模式同一套语义),不在 SQL 里 —— postgres 的
-- POSIX 正则跟 RE2 不是同一门方言,让它先筛一遍就等于让两套方言各漏一点。
WITH RECURSIVE up AS (
  SELECT n.id AS leaf_id, n.genre AS leaf_genre, n.body AS leaf_body,
         n.published AS leaf_published,
         n.id, n.parent_id, ARRAY[n.title]::text[] AS path_titles
  FROM corpus_notes n
  WHERE n.owner_id = $1
  UNION ALL
  SELECT up.leaf_id, up.leaf_genre, up.leaf_body, up.leaf_published, p.id, p.parent_id,
         p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT up.leaf_id AS id, up.leaf_genre AS genre, up.leaf_body AS body,
       up.leaf_published AS published, up.path_titles
FROM up WHERE up.parent_id IS NULL;

-- name: ListAllNotesForExport :many
-- Vault export: all corp notes(any genre) with body/tree/publish — 反向 render 成 vault .md。
SELECT id, genre, parent_id, title, body, tags, published
FROM corpus_notes WHERE owner_id = $1
ORDER BY created_at;

-- name: GetNoteByIDAnyGenre :one
-- 按 id 取一条 corpus note(任一 genre),给 search 索引单条用。
SELECT * FROM corpus_notes WHERE owner_id = $1 AND id = $2 LIMIT 1;

-- name: GetNoteByTitleAnyGenre :one
-- Vault-sync reconcile identity: the vault basename (== title) is unique per owner (check-links.sh
-- resolves [[x]] by basename vault-wide, so basenames must be unique). Match cross-genre so a
-- genre-move (wiki/x.md → subjectivity/x.md) updates the same row in place. Oldest-first is stable
-- across re-syncs; the rare name-clash precedence (folder-note wins) is resolved in the pipeline.
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND title = $2
ORDER BY created_at ASC
LIMIT 1;

-- name: GetNoteBySourcePath :one
-- Vault-sync reconcile identity by the file's vault-relative path. Used when the basename
-- (title) is NOT unique across the vault: two files can share a basename in different folders,
-- but a file has exactly one source path, so this claims the right row instead of rejecting the
-- collision. This is the schema's intended reconcile identity (corpus_notes_source_path_idx).
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND obsidian_source_path = $2
ORDER BY created_at ASC
LIMIT 1;

-- name: CreateNoteSync :one
-- Vault sync create: sets genre/parent/publish + the obsidian identity (source_path, imported_at=now).
-- inbox_source is the vault-source tag for genre='raw' ("obsidian:<path>"); empty for other genres.
INSERT INTO corpus_notes
  (owner_id, genre, parent_id, title, body, tags, published, obsidian_source_path, css_classes, inbox_source, excerpt, aliases, lang, lang_labels, obsidian_imported_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
RETURNING *;

-- name: UpdateNoteSync :one
-- Vault sync update (reconcile): relocate (genre/parent may change on a move), refresh body/tags/publish/excerpt,
-- re-stamp the obsidian identity + inbox_source. Never touches rows absent from the batch (caller upserts per file).
UPDATE corpus_notes
SET genre = $3, parent_id = $4, body = $5, tags = $6, published = $7,
    obsidian_source_path = $8, css_classes = $9, inbox_source = $10, excerpt = $11,
    aliases = $12, lang = $13, lang_labels = $14, obsidian_imported_at = now(), updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: SearchNotes :many
-- 全量关键词搜（DB 端 full-text）；返 meta + snippet（不返完整 body），翻页。自然语言问句按 OR
-- 命中任一词项（' & '→' | '，防 "tell"/"me" 噪声词把 plainto 默认 AND 卡死）；ts_rank 关联度排序。
--
-- **snippet 取的是命中处（`ts_headline`），不是正文开头。** 原来是 `left(body, 200)`，
-- 而这个 vault 的笔记几乎都以一个 `> [!i18n]` 语言切换 callout 开头 —— 那 200 字节全是标记，
-- 清洗之后一个字不剩，于是 owner 搜出来的每一行都没有摘要（F-L-45）。命中处还顺带回答了
-- 「这一行为什么被搜到」，那正是搜索结果该说的话。`StartSel/StopSel` 置空：不要 `<b>` 标记，
-- 摘要要能直接渲给人看（F-L-42 那族：原始标记不许漏到界面上）。
-- **两个空值必须带引号**（`StartSel=""`）：写成 `StartSel=,` 的话 postgres 把后面那截当成值，
-- 于是每个命中词前面都印出一串 `,StopSel=` —— ⑤ 在真语料上当场抓到，而守卫当时没红，
-- 因为它只断了「摘要非空且含命中词」，那串垃圾同时满足这两条。
--
-- updated_at 也一并取上 —— 它以前没被 select，而 wiki/output 那条映射照样把零值渲成
-- `1970-01-01T00:00:00Z` 发出去（F-L-46）。
-- 索引和摘要都走 `corpus_searchable(body)`（定义在 schema.sql）：vault 的 i18n 契约里那一行
-- 语言切换按钮是**呈现件**，不是 owner 写下的字。它以前既进索引（搜「中文」会命中每一条
-- 多语笔记，哪怕正文一个中文字都没有）又进摘要（每条摘要都从 `EN 中文` 开头）——UX-78。
-- 两处必须用同一个表达式：只清摘要的话，搜得到却看不出为什么，那更糟。
SELECT id, parent_id, title, published, updated_at,
       ts_headline('english', corpus_searchable(body),
         replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery,
         'StartSel="",StopSel="",MaxWords=28,MinWords=12,MaxFragments=1'
       ) AS snippet
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
  AND to_tsvector('english',
        title || ' ' || corpus_searchable(body) || ' ' || array_to_string(tags, ' '))
      @@ replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery
ORDER BY ts_rank(
        to_tsvector('english',
          title || ' ' || corpus_searchable(body) || ' ' || array_to_string(tags, ' ')),
        replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery
      ) DESC, updated_at DESC
LIMIT $4 OFFSET $5;

-- name: GetNoteCssClasses :one
-- cssclasses(per-note 呈现钩子)。corpus_read 时补到 CorpusEntry;跨 genre 按 id。
SELECT css_classes FROM corpus_notes WHERE id = $1 AND owner_id = $2;

-- name: GetNoteLang :one
-- 多语渲染要的那两个 frontmatter 字段:身份语言 + 切换器标签。语言**集**不在这儿 ——
-- 它由正文里的语言面推,存一份就会跟正文漂移。跟 cssclasses 同一个形态:读的时候补一次。
SELECT lang, lang_labels FROM corpus_notes WHERE id = $1 AND owner_id = $2;

-- name: PruneAbsentVaultNotes :execrows
-- F-L-6: an AUTHORITATIVE (whole-vault) sync makes the corpus EQUAL the vault — a note deleted from
-- the vault must disappear from the corpus, or "sync" only ever grows and re-syncing can never clean
-- a ghost. The vault is the SINGLE LIVE SOURCE (see the vault-ingestion decision), so there is no
-- "who wins": sync means the destination equals the source. A web edit does NOT pin a note against
-- its own vault — to keep web work, export it back to the vault first, then sync.
--   * obsidian_imported_at IS NOT NULL —— only vault-imported rows. Notes authored on the web or
--     pushed via the service handle were never vault-managed, so their absence from the upload
--     carries no instruction; the vault is not their source.
--   * id <> ALL(keep) —— everything reconciled this run survives.
-- note_refs (src_id/dst_id) and child rows cascade via FK, so a pruned subtree cleans up after itself.
DELETE FROM corpus_notes
WHERE owner_id = $1
  AND obsidian_imported_at IS NOT NULL
  AND NOT (id = ANY($2::uuid[]));

-- name: SetNoteHero :one
-- hero 区 —— 任意 genre 的一条 corpus note 都能有。它不是"一张图":设计里是图 + 压在图上
-- 那句话 + 色调三样一起(见 app 的 Cover 组件)。三列本来就在这张共享表上,以前只有 writing
-- 那条路写它们,于是"每个 genre 都能有 hero"这句话在数据上成立、在代码里不成立。
--
-- 三列一次写全:caller 先读回现值、只覆盖这次给了的那几项,再整份写回。这样"没提到的字段"
-- 不会被顺手抹掉 —— corpus.update 的既有调用方一个 hero 字段都不带。
UPDATE corpus_notes
SET cover_image_asset_id = $3, cover_headline = $4, cover_hue = $5, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, cover_image_asset_id, cover_headline, cover_hue;

-- name: GetNoteHero :one
-- 一条 note 上跟素材有关的那几样:正文(里面的 standmeet-asset 引用)和 hero 三件套。
-- 跨 genre 按 id —— 素材这件事对 genre 是无差别的。
SELECT body, cover_image_asset_id, cover_headline, cover_hue
FROM corpus_notes WHERE id = $1 AND owner_id = $2;
