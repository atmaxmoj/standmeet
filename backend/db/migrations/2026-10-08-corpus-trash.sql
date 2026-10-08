-- 2026-10-08-corpus-trash.sql — a deleted corpus entry waits in the trash before it is gone.
-- Reentrant: safe to run on a database that already has it.
--
-- corpus.delete was a hard DELETE. The owner's AI holds a key that may delete, and the vault sync
-- prunes entries the vault no longer has; one wrong call lost an entry, its subtree (parent_id
-- cascades) and every [[link]] edge to it, with no way back.
--
-- The trash is filled by triggers, not by the delete paths: every way a row leaves corpus_notes
-- (corpus.delete, writings.delete, the sync prune, a parent's cascade) lands here, and no read path
-- changes — a trashed row is simply not in corpus_notes. A link edge is kept only when one of its
-- notes went with it; a save that rewrites a note's edges deletes them too, and that is no delete.
--
-- corpus_trash_restore puts a root and the descendants deleted with it back under their own ids,
-- then the edges whose two notes both exist again. The insert fires corpus_notes_event, so search
-- re-indexes on its own. A periodic job purges rows older than the retention window.
-- events: none (corpus.note.changed fires on the delete and on the restore)
CREATE TABLE IF NOT EXISTS corpus_trash (
    id          bigserial   PRIMARY KEY,
    owner_id    uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    -- tbl —— the table the row came from: corpus_notes, note_refs or writing_refs.
    tbl         text        NOT NULL,
    -- note_id —— the entry's id, for a corpus_notes row; NULL for an edge.
    note_id     uuid        NULL,
    -- batch —— the deleting transaction: a root and its cascaded descendants share it.
    batch       bigint      NOT NULL DEFAULT txid_current(),
    row_data    jsonb       NOT NULL,
    deleted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corpus_trash_owner_note_idx ON corpus_trash (owner_id, note_id);
CREATE INDEX IF NOT EXISTS corpus_trash_deleted_at_idx ON corpus_trash (deleted_at);

CREATE OR REPLACE FUNCTION corpus_trash_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    r   jsonb := to_jsonb(OLD);
    src uuid;
    dst uuid;
BEGIN
    -- An owner being deleted takes the corpus with it: there is nobody to restore for.
    IF NOT EXISTS (SELECT 1 FROM owners WHERE id = OLD.owner_id) THEN
        RETURN NULL;
    END IF;
    IF TG_TABLE_NAME = 'corpus_notes' THEN
        INSERT INTO corpus_trash (owner_id, tbl, note_id, row_data)
        VALUES (OLD.owner_id, TG_TABLE_NAME, OLD.id, r);
        RETURN NULL;
    END IF;
    src := coalesce(r->>'src_id', r->>'src_writing_id')::uuid;
    dst := coalesce(r->>'dst_id', r->>'dst_writing_id')::uuid;
    IF EXISTS (SELECT 1 FROM corpus_notes WHERE id = src)
       AND EXISTS (SELECT 1 FROM corpus_notes WHERE id = dst) THEN
        RETURN NULL;
    END IF;
    INSERT INTO corpus_trash (owner_id, tbl, row_data) VALUES (OLD.owner_id, TG_TABLE_NAME, r);
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS corpus_notes_trash ON corpus_notes;
CREATE TRIGGER corpus_notes_trash AFTER DELETE ON corpus_notes
    FOR EACH ROW EXECUTE FUNCTION corpus_trash_row();
DROP TRIGGER IF EXISTS note_refs_trash ON note_refs;
CREATE TRIGGER note_refs_trash AFTER DELETE ON note_refs
    FOR EACH ROW EXECUTE FUNCTION corpus_trash_row();
DROP TRIGGER IF EXISTS writing_refs_trash ON writing_refs;
CREATE TRIGGER writing_refs_trash AFTER DELETE ON writing_refs
    FOR EACH ROW EXECUTE FUNCTION corpus_trash_row();

-- corpus_trash_restore —— returns the restored entry ids, root first. Errors carry their own
-- SQLSTATE so the caller can word them: SMT01 = not in the trash; SMT02 = the parent is in the
-- trash too (the message is the parent's title). A parent that was purged is gone for good, so the
-- root comes back at the top level. A unique violation (23505) means a live entry took its slug.
CREATE OR REPLACE FUNCTION corpus_trash_restore(p_owner uuid, p_note uuid) RETURNS SETOF uuid
LANGUAGE plpgsql AS $$
DECLARE
    root    corpus_trash;
    pid     uuid;
    ptitle  text;
    r       record;
    ids     uuid[] := '{}';
    src     uuid;
    dst     uuid;
BEGIN
    SELECT * INTO root FROM corpus_trash
    WHERE owner_id = p_owner AND tbl = 'corpus_notes' AND note_id = p_note
    ORDER BY id DESC LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not in the trash' USING ERRCODE = 'SMT01';
    END IF;
    pid := (root.row_data->>'parent_id')::uuid;
    IF pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM corpus_notes WHERE id = pid) THEN
        SELECT row_data->>'title' INTO ptitle FROM corpus_trash
        WHERE owner_id = p_owner AND tbl = 'corpus_notes' AND note_id = pid
        ORDER BY id DESC LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION '%', ptitle USING ERRCODE = 'SMT02';
        END IF;
        root.row_data := jsonb_set(root.row_data, '{parent_id}', 'null');
    END IF;

    FOR r IN
        WITH RECURSIVE t AS (
            SELECT root.id AS id, root.row_data AS row_data, 0 AS depth
            UNION ALL
            SELECT c.id, c.row_data, t.depth + 1
            FROM corpus_trash c JOIN t ON c.row_data->>'parent_id' = t.row_data->>'id'
            WHERE c.owner_id = p_owner AND c.tbl = 'corpus_notes' AND c.batch = root.batch
        )
        SELECT id, row_data FROM t ORDER BY depth
    LOOP
        INSERT INTO corpus_notes SELECT * FROM jsonb_populate_record(NULL::corpus_notes, r.row_data);
        DELETE FROM corpus_trash WHERE id = r.id;
        ids := ids || (r.row_data->>'id')::uuid;
    END LOOP;

    FOR r IN
        SELECT id, tbl, row_data FROM corpus_trash
        WHERE owner_id = p_owner AND tbl IN ('note_refs', 'writing_refs')
    LOOP
        src := coalesce(r.row_data->>'src_id', r.row_data->>'src_writing_id')::uuid;
        dst := coalesce(r.row_data->>'dst_id', r.row_data->>'dst_writing_id')::uuid;
        CONTINUE WHEN NOT (src = ANY(ids) OR dst = ANY(ids));
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM corpus_notes WHERE id = src)
                   OR NOT EXISTS (SELECT 1 FROM corpus_notes WHERE id = dst);
        IF r.tbl = 'note_refs' THEN
            INSERT INTO note_refs SELECT * FROM jsonb_populate_record(NULL::note_refs, r.row_data)
            ON CONFLICT DO NOTHING;
        ELSE
            INSERT INTO writing_refs SELECT * FROM jsonb_populate_record(NULL::writing_refs, r.row_data)
            ON CONFLICT DO NOTHING;
        END IF;
        DELETE FROM corpus_trash WHERE id = r.id;
    END LOOP;

    RETURN QUERY SELECT unnest(ids);
END $$;
