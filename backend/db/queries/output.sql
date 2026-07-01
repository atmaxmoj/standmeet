-- output_entries —— wiki 的最精炼版镜像。query 命名跟 wiki 对齐让代码生成
-- 的方法名易认（CreateOutputEntry / ListOutputByOwner / ...）。

-- name: CreateOutputEntry :one
INSERT INTO output_entries (
    owner_id, parent_id, title, body, tags, source_wiki_ids
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListOutputByOwner :many
SELECT * FROM output_entries
WHERE owner_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: GetOutputByID :one
SELECT * FROM output_entries WHERE id = $1 AND owner_id = $2;

-- name: GetOutputMetaByID :one
-- meta only(无 body):上溯算树派生 path / 判 ACL 用,不为读正文。镜像 GetWikiMetaByID。
SELECT id, parent_id, title, published
FROM output_entries
WHERE id = $1 AND owner_id = $2;

-- name: ListOutputChildren :many
-- 懒加载一层:某 output 节点的直接子(meta only,不带 body);$2 NULL = 根层。翻页用
-- limit/offset。镜像 ListWikiChildren —— output 跟 wiki 同构(都是带 parent_id 的树),
-- 检索按 path 下钻解析靠它,不再特例 output。
SELECT o.id, o.parent_id, o.title, o.published,
       EXISTS(SELECT 1 FROM output_entries c WHERE c.parent_id = o.id) AS has_children
FROM output_entries o
WHERE o.owner_id = $1
  AND (($2::uuid IS NULL AND o.parent_id IS NULL) OR o.parent_id = $2)
ORDER BY o.title ASC
LIMIT $3 OFFSET $4;

-- name: SearchOutputByOwner :many
-- 全量关键词搜(DB 端 full-text);返 meta + snippet(**不返完整 body**),翻页。
-- 镜像 SearchWikiByOwner:自然语言问句按 OR 命中任一词项(' & '→' | '),ts_rank 排序。
SELECT id, parent_id, title, published, left(body, 200) AS snippet
FROM output_entries
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

-- name: ListAllOutputMeta :many
-- 全量 meta(无 body、无 limit):sitemap 枚举所有 indexed output + landing 的树路径
-- 派生用。不带 newest-N cap —— sitemap 必须列全,漏一条就是 SEO bug。带 updated_at
-- 给 sitemap <lastmod>。
SELECT id, parent_id, title, published, updated_at
FROM output_entries
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: DeleteOutput :exec
DELETE FROM output_entries WHERE id = $1 AND owner_id = $2;

-- name: SetOutputTags :exec
UPDATE output_entries SET tags = $3, updated_at = now() WHERE id = $1 AND owner_id = $2;

-- name: UpdateOutputBody :one
-- admin "edit output" 入口；跟 UpdateWikiBody 同构。
UPDATE output_entries
SET title = $3, body = $4, tags = $5, parent_id = $6, show_as_source = $7,
    updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: UpdateOutputSEO :one
-- admin / MCP 编辑 SEO 描述 + indexed 开关（地址树派生,无 path 列）。
UPDATE output_entries
SET excerpt = $2, published = $3, updated_at = now()
WHERE id = $1
RETURNING *;
