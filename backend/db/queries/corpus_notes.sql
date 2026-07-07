-- corpus_notes.sql —— 统一 note 基座的 query。wiki + output 两个 genre 共用这一套（genre 作参数）：
-- 原 wiki 的 13 条 + output 的 11 条近重复 query 收成这 12 条。Repo 层各自绑定自己的 genre 调用。
-- 地址仍纯树派生（parent 链），本表不存 path 列。

-- name: CreateNote :one
INSERT INTO corpus_notes (owner_id, genre, parent_id, title, body, tags, source_ids, css_classes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
-- 编辑 SEO 描述 + published 开关（地址树派生，owner 不自设 path）。
UPDATE corpus_notes
SET excerpt = $2, published = $3, updated_at = now()
WHERE id = $1 AND genre = $4
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

-- name: GetNoteMetaByID :one
-- meta only（无 body）：上溯算树派生 path / 判 ACL 用，不为读正文。
SELECT id, parent_id, title, published
FROM corpus_notes
WHERE id = $1 AND owner_id = $2 AND genre = $3;

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
SELECT id, title, genre FROM corpus_notes WHERE owner_id = $1;

-- name: QueryCorpusNotes :many
-- 原生 standmeet-query 用:按 genre/tag 过滤(空串 = 不筛),并沿 parent 链在 SQL 里算出 path_titles
-- (root→leaf),省掉逐条 N+1 的 path walk。只返 root-reached 行(每个匹配条一行,带完整 path)。
WITH RECURSIVE up AS (
  SELECT n.id AS leaf_id, n.genre AS leaf_genre, n.id, n.parent_id,
         ARRAY[n.title]::text[] AS path_titles
  FROM corpus_notes n
  WHERE n.owner_id = $1
    AND ($2::text = '' OR n.genre = $2::text)
    AND ($3::text = '' OR $3::text = ANY(n.tags))
  UNION ALL
  SELECT up.leaf_id, up.leaf_genre, p.id, p.parent_id, p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT up.leaf_id AS id, up.leaf_genre AS genre, up.path_titles
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

-- name: CreateNoteSync :one
-- Vault sync create: sets genre/parent/publish + the obsidian identity (source_path, imported_at=now).
INSERT INTO corpus_notes
  (owner_id, genre, parent_id, title, body, tags, published, obsidian_source_path, css_classes, obsidian_imported_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
RETURNING *;

-- name: UpdateNoteSync :one
-- Vault sync update (reconcile): relocate (genre/parent may change on a move), refresh body/tags/publish,
-- re-stamp the obsidian identity. Never touches rows absent from the batch (caller upserts per file).
UPDATE corpus_notes
SET genre = $3, parent_id = $4, body = $5, tags = $6, published = $7,
    obsidian_source_path = $8, css_classes = $9, obsidian_imported_at = now(), updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: SearchNotes :many
-- 全量关键词搜（DB 端 full-text）；返 meta + snippet（不返完整 body），翻页。自然语言问句按 OR
-- 命中任一词项（' & '→' | '，防 "tell"/"me" 噪声词把 plainto 默认 AND 卡死）；ts_rank 关联度排序。
SELECT id, parent_id, title, published, left(body, 200) AS snippet
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
  AND to_tsvector('english',
        title || ' ' || body || ' ' || array_to_string(tags, ' '))
      @@ replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery
ORDER BY ts_rank(
        to_tsvector('english',
          title || ' ' || body || ' ' || array_to_string(tags, ' ')),
        replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery
      ) DESC, updated_at DESC
LIMIT $4 OFFSET $5;

-- name: GetNoteCssClasses :one
-- cssclasses(per-note 呈现钩子)。corpus_read 时补到 CorpusEntry;跨 genre 按 id。
SELECT css_classes FROM corpus_notes WHERE id = $1 AND owner_id = $2;
