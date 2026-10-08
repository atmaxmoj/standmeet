-- corpus_trash.sql —— the corpus trash (migrations/2026-10-08-corpus-trash.sql). The triggers fill
-- it; these read it, restore from it and purge it.

-- name: ListCorpusTrash :many
-- One row per root: a trashed entry whose parent was not deleted in the same transaction. The
-- descendants it took with it are counted, not listed — restore brings them back with it.
WITH RECURSIVE n AS (
    SELECT t.id, t.batch, t.note_id, t.row_data, t.deleted_at FROM corpus_trash t
    WHERE t.owner_id = @owner_id::uuid AND t.tbl = 'corpus_notes'
), roots AS (
    SELECT n.* FROM n
    WHERE NOT EXISTS (
        SELECT 1 FROM n p WHERE p.batch = n.batch AND p.note_id::text = n.row_data->>'parent_id'
    )
), sub AS (
    SELECT r.id AS root, r.batch, r.note_id FROM roots r
    UNION ALL
    SELECT sub.root, c.batch, c.note_id
    FROM sub JOIN n c ON c.batch = sub.batch AND c.row_data->>'parent_id' = sub.note_id::text
)
SELECT r.note_id::uuid AS note_id,
       (r.row_data->>'genre')::text AS genre,
       (r.row_data->>'title')::text AS title,
       r.deleted_at,
       (SELECT count(*) - 1 FROM sub WHERE sub.root = r.id)::bigint AS descendants
FROM roots r
ORDER BY r.deleted_at DESC, r.id DESC;

-- name: RestoreFromCorpusTrash :many
-- The restored entry ids, root first. Errors: SMT01 not in the trash, SMT02 the parent is in the
-- trash too (message = its title), 23505 a live entry took the slug.
SELECT id::uuid FROM corpus_trash_restore(@owner_id::uuid, @note_id::uuid) AS id;

-- name: PurgeCorpusTrash :execrows
DELETE FROM corpus_trash WHERE deleted_at < @before::timestamptz;
