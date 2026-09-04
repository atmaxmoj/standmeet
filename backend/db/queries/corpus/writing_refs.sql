-- name: DeleteRefsBySrc :exec
-- SaveWriting rebuild of src outbound edges, step 1: clear old edges.
DELETE FROM writing_refs WHERE src_writing_id = $1;

-- name: InsertWritingRef :exec
-- SaveWriting rebuild of src outbound edges, step 2: insert new edges. A duplicate src+dst
-- would collide on the primary key, but the caller dedupes dst before calling, so normally it does not.
INSERT INTO writing_refs (src_writing_id, dst_writing_id, owner_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListBacklinksForWriting :many
-- Used to render "linked from" on the public /writings/<slug>. Returns the backlink source
-- writing's slug + title. Only lists src writings that are published (a visitor cannot see drafts).
-- writing is folded into corpus_notes (genre='writing', #151), so JOIN the unified table and limit by genre.
SELECT w.slug, w.title
FROM writing_refs wr
JOIN corpus_notes w ON w.id = wr.src_writing_id AND w.genre = 'writing'
WHERE wr.dst_writing_id = $1
  AND w.owner_id = $2
  AND w.published_at IS NOT NULL
ORDER BY w.published_at DESC NULLS LAST, w.title ASC;

-- name: ListOutboundRefs :many
-- admin view of what a writing references —— the source data for the "broken refs" report. Returns each edge's
-- dst slug + title (via JOIN: the means to clean up edges whose dst was deleted but the edge remains).
SELECT w.slug, w.title
FROM writing_refs wr
JOIN corpus_notes w ON w.id = wr.dst_writing_id AND w.genre = 'writing'
WHERE wr.src_writing_id = $1
ORDER BY w.title ASC;
