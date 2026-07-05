-- name: DeleteWikiRefsBySrc :exec
-- 重建 src 出度第一步：清旧边（PromoteToWiki / UpdateWiki 同事务）。
DELETE FROM wiki_refs WHERE src_wiki_id = $1;

-- name: InsertWikiRef :exec
-- 重建 src 出度第二步：插新边。caller 已去重 + 排除 self-link。
INSERT INTO wiki_refs (src_wiki_id, dst_wiki_id, owner_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListWikiBacklinks :many
-- 「cited by」：指向 dst 的源 wiki（id + title）。只列 published 的源（visitor
-- 能打开的公开条目）。path 由 caller 用 WikiTreePaths 算。
SELECT w.id, w.title
FROM wiki_refs wr
JOIN corpus_notes w ON w.id = wr.src_wiki_id AND w.genre = 'wiki'
WHERE wr.dst_wiki_id = $1
  AND w.owner_id = $2
  AND w.published = true
ORDER BY w.title ASC;

-- name: ListWikiOutbound :many
-- 「read next / sources」：src 引用了哪些 wiki（id + title）。只列 published
-- 的目标。「N corpus sources」= len(本结果)，实时数不落列。
SELECT w.id, w.title
FROM wiki_refs wr
JOIN corpus_notes w ON w.id = wr.dst_wiki_id AND w.genre = 'wiki'
WHERE wr.src_wiki_id = $1
  AND w.published = true
ORDER BY w.title ASC;

-- name: ListNoteOutboundAll :many
-- admin「read next」：src 引用了哪些 note（id+title）—— **任一 genre**、不限 published（owner 看全，
-- 含未发布）。跨-genre `[[link]]` 归一后，wiki 可引用 output/subjectivity，这里不再按 genre 过滤。
SELECT n.id, n.title
FROM wiki_refs wr
JOIN corpus_notes n ON n.id = wr.dst_wiki_id
WHERE wr.src_wiki_id = $1 AND n.owner_id = $2
ORDER BY n.title ASC;

-- name: ListNoteBacklinksAll :many
-- admin「cited by」：哪些 note 引用了 dst（id+title）—— 任一 genre、不限 published。
SELECT n.id, n.title
FROM wiki_refs wr
JOIN corpus_notes n ON n.id = wr.src_wiki_id
WHERE wr.dst_wiki_id = $1 AND n.owner_id = $2
ORDER BY n.title ASC;
