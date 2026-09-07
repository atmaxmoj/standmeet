-- 2026-09-06-traffic.sql — first-party visitor traffic (docs/design/traffic.md).
--
-- Two tables. `visit_viewer` answers one question only: is this viewer new or returning.
-- `visit_event` holds every recorded event; a view is an event with an empty event_name.
--
-- Upgrade path: both tables are new, so an existing instance gains empty tables and the
-- traffic panel reads as "nothing yet" until the first visitor arrives. No backfill is
-- possible — traffic before this release was never recorded anywhere.
--
-- Reentrant: IF NOT EXISTS throughout, so a rerun against an instance already in this
-- shape is a no-op.

CREATE TABLE IF NOT EXISTS visit_viewer (
    -- viewer_id — hash(salt, owner_id, ip, user_agent). The salt rotates monthly, so this
    -- id cannot be linked across months. The IP itself is never stored.
    viewer_id      text        PRIMARY KEY,
    owner_id       uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    first_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visit_viewer_owner_idx ON visit_viewer(owner_id, first_seen_at);

CREATE TABLE IF NOT EXISTS visit_event (
    event_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    -- viewer_id — NULL for a surface with no browser (the IM bridge). Every aggregate must
    -- tolerate it: such a row counts as one visit and zero identified viewers.
    -- Deliberately NOT a foreign key to visit_viewer: the event is the fact, the viewer row
    -- is a derived convenience, and an event must never be lost to a cleanup of the other.
    viewer_id       text,
    visit_id        text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    surface         text        NOT NULL,
    -- event_name — '' means this event is a view.
    event_name      text        NOT NULL DEFAULT '',
    -- is_bot — bot traffic is STORED, not dropped (umami drops it). Excluded from every
    -- default aggregate. A link-preview fetch of a coded landing URL tells the owner their
    -- link was pasted into a chat app, which is the earliest signal the job loop produces.
    is_bot          boolean     NOT NULL DEFAULT false,

    -- url_path is DISPLAY ONLY. Never group an entity-shaped surface by it: a corpus slug
    -- can be renamed or reparented, and grouping by path splits one entry's history into
    -- two rows that cannot be summed. Group by (entity_kind, entity_id). See traffic.md §6.
    url_path        text        NOT NULL DEFAULT '',
    url_query       text        NOT NULL DEFAULT '',
    page_title      text        NOT NULL DEFAULT '',
    hostname        text        NOT NULL DEFAULT '',

    referrer_domain text        NOT NULL DEFAULT '',
    referrer_path   text        NOT NULL DEFAULT '',
    utm_source      text        NOT NULL DEFAULT '',
    utm_medium      text        NOT NULL DEFAULT '',
    utm_campaign    text        NOT NULL DEFAULT '',
    utm_content     text        NOT NULL DEFAULT '',
    utm_term        text        NOT NULL DEFAULT '',
    -- src — 'qr' when the visitor scanned a printed code, 'link' when they clicked one.
    -- Without it a paper scan and an emailed click are the same row.
    src             text        NOT NULL DEFAULT '',

    -- entity_id — the IMMUTABLE corpus id, never a slug. entity_title is a snapshot used
    -- only when the entity has since been deleted; the live title wins whenever the join
    -- resolves. No foreign key: deleting a corpus entry must not erase who read it.
    entity_kind     text        NOT NULL DEFAULT '',
    entity_id       text        NOT NULL DEFAULT '',
    entity_title    text        NOT NULL DEFAULT '',

    -- code_id / role_id / chat_session_id / embed_id carry no foreign key for the same
    -- reason: revoking a code must not erase the visits it brought in. The label is
    -- snapshotted so a revoked code still reads as itself in the panel.
    code_id         uuid,
    code_label      text        NOT NULL DEFAULT '',
    role_id         uuid,
    chat_session_id uuid,
    embed_id        uuid,
    microsite_slug  text        NOT NULL DEFAULT '',

    browser         text        NOT NULL DEFAULT '',
    os              text        NOT NULL DEFAULT '',
    device          text        NOT NULL DEFAULT '',
    screen          text        NOT NULL DEFAULT '',
    language        text        NOT NULL DEFAULT '',
    country         text        NOT NULL DEFAULT '',
    region          text        NOT NULL DEFAULT '',
    city            text        NOT NULL DEFAULT '',

    props           jsonb       NOT NULL DEFAULT '{}'
);

-- Index shape ported from umami (prisma/schema.prisma:152-165): every dimension the panel
-- can group by gets (owner_id, created_at, <dimension>). The partial index carries the
-- default read path, which always excludes bots.
CREATE INDEX IF NOT EXISTS visit_event_owner_time_idx
    ON visit_event(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS visit_event_human_idx
    ON visit_event(owner_id, created_at DESC) WHERE NOT is_bot;
CREATE INDEX IF NOT EXISTS visit_event_path_idx
    ON visit_event(owner_id, created_at, url_path);
CREATE INDEX IF NOT EXISTS visit_event_entity_idx
    ON visit_event(owner_id, created_at, entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS visit_event_referrer_idx
    ON visit_event(owner_id, created_at, referrer_domain);
CREATE INDEX IF NOT EXISTS visit_event_name_idx
    ON visit_event(owner_id, created_at, event_name);
CREATE INDEX IF NOT EXISTS visit_event_surface_idx
    ON visit_event(owner_id, created_at, surface);
CREATE INDEX IF NOT EXISTS visit_event_code_idx
    ON visit_event(owner_id, created_at, code_id);
CREATE INDEX IF NOT EXISTS visit_event_country_idx
    ON visit_event(owner_id, created_at, country);
CREATE INDEX IF NOT EXISTS visit_event_device_idx
    ON visit_event(owner_id, created_at, device);
CREATE INDEX IF NOT EXISTS visit_event_browser_idx
    ON visit_event(owner_id, created_at, browser);
CREATE INDEX IF NOT EXISTS visit_event_viewer_idx
    ON visit_event(owner_id, viewer_id, created_at);
CREATE INDEX IF NOT EXISTS visit_event_visit_idx
    ON visit_event(owner_id, visit_id, created_at);
