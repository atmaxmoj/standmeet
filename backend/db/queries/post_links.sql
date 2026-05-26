-- name: DeleteLinksBySrc :exec
-- SavePost 重建 src 出度第一步：清掉旧边。
DELETE FROM post_links WHERE src_post_id = $1;

-- name: InsertPostLink :exec
-- SavePost 重建 src 出度第二步：插新边。同 src+dst 撞主键报错，但
-- caller 在调前已经把 dst 去重过，正常不会撞。
INSERT INTO post_links (src_post_id, dst_post_id, owner_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListBacklinksForPost :many
-- public /blog/<slug> 渲染 "linked from" 用。返 backlink 来源 post 的
-- slug + title。只列 src post 已 published 的（visitor 看不见草稿）。
SELECT p.slug, p.title
FROM post_links pl
JOIN posts p ON p.id = pl.src_post_id
WHERE pl.dst_post_id = $1
  AND p.owner_id = $2
  AND p.published_at IS NOT NULL
ORDER BY p.published_at DESC NULLS LAST, p.title ASC;

-- name: ListOutboundLinks :many
-- admin 看一篇 post 出度的什么 —— "broken links" 报表的源数据。返每条边
-- 的 dst slug + title（用 LEFT JOIN：dst 已被删掉但边还在的清除手段）。
SELECT p.slug, p.title
FROM post_links pl
JOIN posts p ON p.id = pl.dst_post_id
WHERE pl.src_post_id = $1
ORDER BY p.title ASC;
