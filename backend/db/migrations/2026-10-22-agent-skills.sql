-- 2026-10-22-agent-skills.sql —— the independent Skills subsystem (skill-handover spec).
-- A skill is a named, versioned block of text + metadata an agent pulls and follows. Its own
-- tables only: no foreign key into corpus / code / microsite / applications (owner_id is the
-- tenant root every table carries, not domain coupling). Every edit is a new version; old
-- versions stay readable so a run can replay the body it followed.

CREATE TABLE IF NOT EXISTS agent_skills (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    slug            text        NOT NULL,
    name            text        NOT NULL,
    description     text        NOT NULL DEFAULT '',
    -- source —— 'bundled' | 'owner' | 'third-party'; metadata only, grants nothing.
    source          text        NOT NULL,
    current_version integer     NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, slug)
);

CREATE TABLE IF NOT EXISTS agent_skill_versions (
    skill_id   uuid        NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    version    integer     NOT NULL,
    body       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (skill_id, version)
);
