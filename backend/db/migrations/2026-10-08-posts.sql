-- 2026-10-08-posts.sql — posts: short untitled updates, each with its own audience
-- (docs/design/posts.md). Reentrant: safe to run on a database that already has it.
--
-- post_visible is THE visibility rule for every non-owner reader: every query that serves a post
-- to someone other than the owner calls it, so the rule has one home. A role deleted later leaves
-- every post's list (posts_forget_role); a roles post whose list empties falls back to private,
-- never public — the CHECK makes a roles post with no roles impossible to store.
-- events: none (its facts are recorded as domain events by the posts use cases: post.created / post.updated / post.deleted)
CREATE TABLE IF NOT EXISTS posts (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    body             text        NOT NULL CHECK (btrim(body) <> ''),
    visibility       text        NOT NULL DEFAULT 'private'
                                 CHECK (visibility IN ('private', 'public', 'roles')),
    visible_role_ids uuid[]      NOT NULL DEFAULT '{}',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz NULL,
    CONSTRAINT posts_roles_list CHECK ((visibility = 'roles') = (cardinality(visible_role_ids) > 0))
);
CREATE INDEX IF NOT EXISTS posts_timeline_idx
    ON posts(owner_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_trash_idx
    ON posts(owner_id, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION post_visible(p_visibility text, p_roles uuid[], p_viewer_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT p_visibility = 'public'
        OR (p_visibility = 'roles' AND p_viewer_role = ANY(p_roles::text[]))
$$;

CREATE OR REPLACE FUNCTION posts_forget_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE posts
       SET visible_role_ids = array_remove(visible_role_ids, OLD.id),
           visibility = CASE WHEN cardinality(array_remove(visible_role_ids, OLD.id)) = 0
                             THEN 'private' ELSE visibility END
     WHERE OLD.id = ANY(visible_role_ids);
    RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS roles_forget_in_posts ON roles;
CREATE TRIGGER roles_forget_in_posts AFTER DELETE ON roles
    FOR EACH ROW EXECUTE FUNCTION posts_forget_role();
