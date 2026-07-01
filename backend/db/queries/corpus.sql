-- name: CreateRawEntry :one
INSERT INTO raw_entries (owner_id, body, source, source_meta, tags, flagged_private)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListRawByOwner :many
SELECT * FROM raw_entries
WHERE owner_id = $1 AND archived = false
ORDER BY created_at DESC
LIMIT $2;

-- name: GetRawByID :one
SELECT * FROM raw_entries WHERE id = $1 AND owner_id = $2;

-- name: ArchiveRaw :exec
UPDATE raw_entries SET archived = true WHERE id = $1 AND owner_id = $2;

-- name: SetRawTags :exec
UPDATE raw_entries SET tags = $3 WHERE id = $1 AND owner_id = $2;

-- name: MarkRawPromoted :exec
UPDATE raw_entries SET promoted_to = $3 WHERE id = $1 AND owner_id = $2;

-- name: UpdateRawBody :one
-- admin "edit raw" 入口：改 body + tags + flagged_private。source 不动
-- （source 是 ingest 来源标签，编辑不该改）。
UPDATE raw_entries
SET body = $3, tags = $4, flagged_private = $5
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: CreateWikiEntry :one
INSERT INTO wiki_entries (owner_id, parent_id, title, body, tags, source_raw_ids)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListWikiByOwner :many
SELECT * FROM wiki_entries
WHERE owner_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: GetWikiByID :one
SELECT * FROM wiki_entries WHERE id = $1 AND owner_id = $2;

-- name: DeleteWiki :exec
DELETE FROM wiki_entries WHERE id = $1 AND owner_id = $2;

-- name: SetWikiTags :exec
UPDATE wiki_entries SET tags = $3, updated_at = now() WHERE id = $1 AND owner_id = $2;

-- name: UpdateWikiBody :one
-- admin "edit wiki" 入口：改 title/body/tags/parent_id/show_as_source。
-- excerpt / published 由 UpdateWikiSEO 单独负责。地址纯树派生,无 path 列。
UPDATE wiki_entries
SET title = $3, body = $4, tags = $5, parent_id = $6, show_as_source = $7,
    updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: UpdateWikiSEO :one
-- admin / MCP 编辑 SEO 描述 + indexed 开关（地址树派生,owner 不再自设 path）。
UPDATE wiki_entries
SET excerpt = $2, published = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- 地址(path)是 induced：纯从 parent 链 + title slug 算（usecases.WikiTreePaths），
-- 不存列、不可由 owner 自设。

-- name: ListWikiChildren :many
-- 懒加载一层:某节点的**直接子**(meta only,**不带 body**);$2 为 NULL = 根层。
-- has_children 给 caller 判还能不能往下钻;翻页用 limit/offset。
SELECT w.id, w.parent_id, w.title, w.published,
       EXISTS(SELECT 1 FROM wiki_entries c WHERE c.parent_id = w.id) AS has_children
FROM wiki_entries w
WHERE w.owner_id = $1
  AND (($2::uuid IS NULL AND w.parent_id IS NULL) OR w.parent_id = $2)
ORDER BY w.title ASC
LIMIT $3 OFFSET $4;

-- name: GetWikiMetaByID :one
-- meta only(无 body):上溯算 path / 判 ACL 用,不为读正文。
SELECT id, parent_id, title, published
FROM wiki_entries
WHERE id = $1 AND owner_id = $2;

-- name: CountWikiStats :one
-- 侧栏脚定位计数:总条数 / 根条数 / 非公开(gated)条数。纯聚合,不 load 树,零内存压力。
SELECT
  count(*) AS entries,
  count(*) FILTER (WHERE parent_id IS NULL) AS roots,
  count(*) FILTER (WHERE NOT published) AS gated
FROM wiki_entries
WHERE owner_id = $1;

-- name: ListAllWikiMeta :many
-- 全量 meta(无 body、无 limit):sitemap 枚举所有 indexed wiki + landing 的 [[X]]
-- 渲染 title→path 索引用。不带 newest-N cap —— sitemap/链接解析必须看全量,漏一条
-- 就是 SEO bug / 断链。带 updated_at 给 sitemap <lastmod>。
SELECT id, parent_id, title, published, updated_at
FROM wiki_entries
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: SearchWikiByOwner :many
-- 全量关键词搜(DB 端 full-text);返 meta + snippet(**不返完整 body**),翻页。
-- 自然语言问句("tell me about zephyrqx")按 OR 命中任一词项 —— plainto 默认 AND
-- 会被 "tell"/"me" 这类噪声词卡死,故把 ' & ' 改成 ' | ';再按 ts_rank 关联度排序
-- (recency 退居其次),让最相关的条目落到首位供 LLM read。
SELECT id, parent_id, title, published, left(body, 200) AS snippet
FROM wiki_entries
WHERE owner_id = $1
  AND to_tsvector('english',
        title || ' ' || body || ' ' || array_to_string(tags, ' '))
      @@ replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery
ORDER BY ts_rank(
        to_tsvector('english',
          title || ' ' || body || ' ' || array_to_string(tags, ' ')),
        replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery
      ) DESC, updated_at DESC
LIMIT $3 OFFSET $4;
