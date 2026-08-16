-- 2026-08-16 · corpus_searchable(body) —— keep the language switcher out of search (UX-78).
--
-- Same reason as the file next to it: schema.sql runs only on a fresh volume, so a declared
-- function does not exist on a live instance until it is created by hand. SearchNotes calls this
-- one, so a prod that misses it answers every owner search with an error — apply it in the same
-- deploy as the query.
--
-- CREATE OR REPLACE, so re-running is harmless. No data is touched: the function derives its
-- result at query time, and `body` keeps every byte the owner wrote.
--
-- The definition is copied verbatim from backend/db/schema.sql; that file stays the authority.

CREATE OR REPLACE FUNCTION corpus_searchable(body text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN regexp_replace(
        regexp_replace(body, '(?in)^.*</?(label|input)[ />].*$', '', 'g'),
        '(?in)^[ \t>]*\[!(i18n|lang)\][+-]?[ \t]*[a-z-]*[ \t]*$', '', 'g');
