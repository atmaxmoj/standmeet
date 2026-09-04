-- name: DeleteNoteRefsBySrc :exec
-- Rebuild src outbound edges, step 1: clear old edges (same transaction as PromoteToWiki / UpdateWiki).
DELETE FROM note_refs WHERE src_id = $1;

-- name: InsertNoteRef :exec
-- Rebuild src outbound edges, step 2: insert new edges. The caller has already deduped and excluded self-links.
INSERT INTO note_refs (src_id, dst_id, owner_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListWikiBacklinks :many
-- "cited by": source wikis pointing at dst (id + title). Only lists published sources
-- (public entries a visitor can open). The caller computes path with WikiTreePaths.
SELECT w.id, w.title
FROM note_refs wr
JOIN corpus_notes w ON w.id = wr.src_id AND w.genre = 'wiki'
WHERE wr.dst_id = $1
  AND w.owner_id = $2
  AND w.published = true
ORDER BY w.title ASC;

-- name: ListWikiOutbound :many
-- "read next / sources": which wikis src references (id + title). Only lists published
-- targets. "N corpus sources" = len(this result), counted live, not stored in a column.
SELECT w.id, w.title
FROM note_refs wr
JOIN corpus_notes w ON w.id = wr.dst_id AND w.genre = 'wiki'
WHERE wr.src_id = $1
  AND w.published = true
ORDER BY w.title ASC;

-- name: ListNoteOutboundAll :many
-- admin "read next": which notes src references (id+title) —— **any genre**, not limited to published
-- (the owner sees everything, including unpublished). After cross-genre `[[link]]` normalization, a wiki can
-- reference output/subjectivity, so this no longer filters by genre.
SELECT n.id, n.title
FROM note_refs wr
JOIN corpus_notes n ON n.id = wr.dst_id
WHERE wr.src_id = $1 AND n.owner_id = $2
ORDER BY n.title ASC;

-- name: ListNoteBacklinksAll :many
-- admin "cited by": which notes reference dst (id+title) —— any genre, not limited to published.
SELECT n.id, n.title
FROM note_refs wr
JOIN corpus_notes n ON n.id = wr.src_id
WHERE wr.dst_id = $1 AND n.owner_id = $2
ORDER BY n.title ASC;
