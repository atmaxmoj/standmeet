-- name: DeleteRefsBySrc :exec
-- SaveWriting 重建 src 出度第一步：清掉旧边。
DELETE FROM writing_refs WHERE src_writing_id = $1;

-- name: InsertWritingRef :exec
-- SaveWriting 重建 src 出度第二步：插新边。同 src+dst 撞主键报错，但
-- caller 在调前已经把 dst 去重过，正常不会撞。
INSERT INTO writing_refs (src_writing_id, dst_writing_id, owner_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListBacklinksForWriting :many
-- public /writings/<slug> 渲染 "linked from" 用。返 backlink 来源 writing 的
-- slug + title。只列 src writing 已 published 的（visitor 看不见草稿）。
SELECT w.slug, w.title
FROM writing_refs wr
JOIN writings w ON w.id = wr.src_writing_id
WHERE wr.dst_writing_id = $1
  AND w.owner_id = $2
  AND w.published_at IS NOT NULL
ORDER BY w.published_at DESC NULLS LAST, w.title ASC;

-- name: ListOutboundRefs :many
-- admin 看一篇 writing 出度的什么 —— "broken refs" 报表的源数据。返每条边
-- 的 dst slug + title（用 JOIN：dst 已被删掉但边还在的清除手段）。
SELECT w.slug, w.title
FROM writing_refs wr
JOIN writings w ON w.id = wr.dst_writing_id
WHERE wr.src_writing_id = $1
ORDER BY w.title ASC;
