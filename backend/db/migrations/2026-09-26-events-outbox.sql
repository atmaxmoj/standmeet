-- 2026-09-26-events-outbox.sql — the transactional outbox and the corpus_notes event trigger
-- (docs/design/event-bus-outbox-webhooks.md). Reentrant: safe to run on a database that already
-- has it.

-- events —— the outbox. A row commits in the same transaction as the change it describes; the
-- relay (internal/infra/events) claims rows with fanned_out_at IS NULL … FOR UPDATE SKIP LOCKED,
-- enqueues one job per matching subscriber and stamps fanned_out_at in that same transaction.
-- No sequence cursor: a cursor skips a row whose transaction took its seq early and committed late.
-- events: none (the outbox itself)
CREATE TABLE IF NOT EXISTS events (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    seq            bigint      GENERATED ALWAYS AS IDENTITY,
    owner_id       uuid        NULL,
    type           text        NOT NULL,
    subject        text        NOT NULL,
    data           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    fanned_out_at  timestamptz NULL,
    -- fanout —— [{subscriber, job_id}]: which job each subscriber got (the Tasks panel's event detail).
    fanout         jsonb       NOT NULL DEFAULT '[]'::jsonb,
    relay_failures int         NOT NULL DEFAULT 0,
    poisoned_at    timestamptz NULL,
    last_error     text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_unfanned_idx ON events (seq)
    WHERE fanned_out_at IS NULL AND poisoned_at IS NULL;
CREATE INDEX IF NOT EXISTS events_occurred_idx ON events (occurred_at);
-- High churn (insert, then one update), low volume: vacuum early so dead tuples do not pile up.
ALTER TABLE events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);

-- corpus_path_segment —— the SQL copy of Go's usecase.PathSegment (lowercase; runs of anything that
-- is not a letter or digit become one '-'; cut to 80 characters; trimmed; empty → 'untitled').
-- It exists only so the trigger can name an event's subject. The Go function is the rule;
-- TestSQLPathSegmentMatchesGo fails the moment the two disagree.
CREATE OR REPLACE FUNCTION corpus_path_segment(title text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(nullif(btrim(left(btrim(regexp_replace(lower(title), '[^[:alnum:]]+', '-', 'g'), '-'), 80), '-'), ''), 'untitled')
$$;

-- corpus_note_uri —— `<genre>://<path>` for a note, walking the parent chain (at most 32 levels,
-- like Go's SyncNotePath). raw is addressed by id, writing by slug.
CREATE OR REPLACE FUNCTION corpus_note_uri(p_genre text, p_id uuid, p_slug text, p_title text, p_parent uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
    segs  text[] := ARRAY[corpus_path_segment(p_title)];
    cur   uuid   := p_parent;
    t     text;
    par   uuid;
    depth int    := 0;
BEGIN
    IF p_genre = 'raw' THEN RETURN 'raw://' || p_id::text; END IF;
    IF p_genre = 'writing' THEN RETURN 'writing://writings/' || p_slug; END IF;
    WHILE cur IS NOT NULL AND depth < 32 LOOP
        SELECT n.title, n.parent_id INTO t, par FROM corpus_notes n WHERE n.id = cur;
        EXIT WHEN NOT FOUND;
        segs := corpus_path_segment(t) || segs;
        cur := par;
        depth := depth + 1;
    END LOOP;
    RETURN p_genre || '://' || array_to_string(segs, '/');
END $$;

-- corpus_notes_event —— writes corpus.note.changed for every insert, delete, and update of a
-- watched column. The WHEN clauses on the triggers below keep no-op updates (updated_at,
-- import bookkeeping) silent.
CREATE OR REPLACE FUNCTION corpus_notes_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    r   corpus_notes;
    op  text;
BEGIN
    IF TG_OP = 'DELETE' THEN r := OLD; op := 'deleted';
    ELSIF TG_OP = 'INSERT' THEN r := NEW; op := 'created';
    ELSE r := NEW; op := 'updated';
    END IF;
    INSERT INTO events (owner_id, type, subject, data) VALUES (
        r.owner_id, 'corpus.note.changed',
        corpus_note_uri(r.genre, r.id, r.slug, r.title, r.parent_id),
        jsonb_build_object(
            'op', op, 'note_id', r.id, 'genre', r.genre,
            'parent_id', coalesce(r.parent_id::text, ''),
            'published', r.published,
            'was_published', CASE WHEN TG_OP = 'UPDATE' THEN OLD.published ELSE r.published END,
            'path_changed', TG_OP = 'UPDATE' AND (OLD.title, OLD.parent_id) IS DISTINCT FROM (NEW.title, NEW.parent_id)
        ));
    PERFORM pg_notify('standmeet_events', '');
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS corpus_notes_event_ins_del ON corpus_notes;
CREATE TRIGGER corpus_notes_event_ins_del AFTER INSERT OR DELETE ON corpus_notes
    FOR EACH ROW EXECUTE FUNCTION corpus_notes_event();

DROP TRIGGER IF EXISTS corpus_notes_event_upd ON corpus_notes;
CREATE TRIGGER corpus_notes_event_upd AFTER UPDATE ON corpus_notes
    FOR EACH ROW WHEN (
        (OLD.genre, OLD.title, OLD.body, OLD.tags, OLD.parent_id, OLD.published, OLD.show_as_source,
         OLD.aliases, OLD.excerpt, OLD.slug, OLD.archived, OLD.css_classes, OLD.lang)
        IS DISTINCT FROM
        (NEW.genre, NEW.title, NEW.body, NEW.tags, NEW.parent_id, NEW.published, NEW.show_as_source,
         NEW.aliases, NEW.excerpt, NEW.slug, NEW.archived, NEW.css_classes, NEW.lang)
    ) EXECUTE FUNCTION corpus_notes_event();
