-- 2026-10-15-access-code-expiry.sql —— an access code's expiry, enforced and defined once.
--
-- access_code_follows_page: a code bound to an ephemeral page lives on the page's clock
-- (docs/design/job-loop-retention.md). access_code_expired: the one rule every reader calls (the
-- door, the session sweep, the list filter, the counts). No data changes.

CREATE OR REPLACE FUNCTION access_code_follows_page(page uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM microsites m
                   WHERE m.id = page AND m.status <> 'deleted' AND m.bundle_id IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION access_code_expired(expires timestamptz, page uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT expires IS NOT NULL AND expires <= now() AND NOT access_code_follows_page(page)
$$;
