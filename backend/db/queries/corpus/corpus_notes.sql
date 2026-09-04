-- corpus_notes.sql —— queries for the unified note base. The wiki + output genres share this one set
-- (genre as a parameter): the original 13 wiki + 11 output near-duplicate queries collapse into these 12.
-- Each Repo layer binds its own genre when calling. Addresses are still purely tree-derived (parent chain);
-- this table stores no path column.

-- name: CreateNote :one
INSERT INTO corpus_notes (owner_id, genre, parent_id, title, body, tags, source_ids, css_classes, show_as_source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListNotesByOwner :many
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
ORDER BY created_at DESC
LIMIT $3;

-- name: GetNoteByID :one
SELECT * FROM corpus_notes WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: DeleteNote :exec
DELETE FROM corpus_notes WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: SetNoteTags :exec
UPDATE corpus_notes SET tags = $4, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: UpdateNoteBody :one
-- admin "edit" entry point: change title/body/tags/parent_id/show_as_source. excerpt/published go through UpdateNoteSEO.
UPDATE corpus_notes
SET title = $4, body = $5, tags = $6, parent_id = $7, show_as_source = $8, css_classes = $9, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = $3
RETURNING *;

-- name: UpdateNoteSEO :one
-- Edit the SEO description + published toggle (addresses are tree-derived; the owner does not set path). owner_id
-- is required: without it, under multi-tenancy this is a BOLA (editing by id into another owner's note) —— consistent
-- with all corpus_notes mutations.
UPDATE corpus_notes
SET excerpt = $2, published = $3, updated_at = now()
WHERE id = $1 AND genre = $4 AND owner_id = $5
RETURNING *;

-- name: ListNoteChildren :many
-- Lazy-load one level: a node's direct children (meta only, no body); $3 NULL = root level.
-- has_children says whether it can be drilled into.
SELECT n.id, n.parent_id, n.title, n.published,
       EXISTS(SELECT 1 FROM corpus_notes c WHERE c.parent_id = n.id AND c.genre = $2) AS has_children
FROM corpus_notes n
WHERE n.owner_id = $1 AND n.genre = $2
  AND (($3::uuid IS NULL AND n.parent_id IS NULL) OR n.parent_id = $3)
ORDER BY n.title ASC
LIMIT $4 OFFSET $5;

-- name: ListNoteChildrenAdmin :many
-- Admin lazy tree layer: one parent's direct children as FULL rows (body/tags/excerpt/…) +
-- has_children (can drill down) + path_titles (root→leaf, for the server-slugified "view live"
-- address). Owner-scoped, NO ACL cascade — the owner sees every status (unlike the public
-- label-only ListNoteChildren). $3 NULL = root layer. Siblings of one parent, so no cap.
WITH RECURSIVE up AS (
  SELECT c.id AS leaf_id, c.id, c.parent_id, ARRAY[c.title]::text[] AS path_titles
  FROM corpus_notes c
  WHERE c.owner_id = $1 AND c.genre = $2
    AND (($3::uuid IS NULL AND c.parent_id IS NULL) OR c.parent_id = $3)
  UNION ALL
  SELECT up.leaf_id, p.id, p.parent_id, p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT sqlc.embed(n),
       EXISTS(SELECT 1 FROM corpus_notes ch WHERE ch.parent_id = n.id AND ch.genre = $2) AS has_children,
       (SELECT u.path_titles FROM up u WHERE u.leaf_id = n.id AND u.parent_id IS NULL LIMIT 1) AS path_titles
FROM corpus_notes n
WHERE n.owner_id = $1 AND n.genre = $2
  AND (($3::uuid IS NULL AND n.parent_id IS NULL) OR n.parent_id = $3)
ORDER BY n.title ASC;

-- name: ListDistinctTagsByGenre :many
-- **All** tags that ever appeared within one genre, deduped and sorted. For the panel's tag row.
-- It must be corpus-level: the tag row used to be inferred from "the page already loaded", so tags that only
-- existed outside that page had **no chip at all** —— you could not click them, and so could not discover what you
-- were missing (the second half of F-L-23).
SELECT DISTINCT unnest(tags)::text AS tag
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
ORDER BY 1;

-- name: ListNotesByOwnerPage :many
-- Grid pagination (infinite scroll): keyset on (created_at DESC, id DESC). $3/$4 = the
-- last row's (created_at, id) cursor — both NULL = first page. Composite tiebreak because
-- a vault sync batch can share created_at. LIMIT $5 (+1 caller-side → has_more). Full row
-- via sqlc.embed + path_titles so the server slugifies the address even on a partial page.
--
-- $6 = tag filter ('' / NULL = no filter). It has to live HERE, next to the ORDER BY and the
-- LIMIT, because the page is what the cursor walks: filtering client-side after the fact means
-- the filter only ever sees one page, which is how the panel came to report 1 math note against
-- a corpus holding 137 (F-L-23). The recursive CTE stays unfiltered on purpose — it only exists
-- to resolve each returned row's ancestor titles, and narrowing it would not change any answer.
WITH RECURSIVE up AS (
  SELECT c.id AS leaf_id, c.id, c.parent_id, ARRAY[c.title]::text[] AS path_titles
  FROM corpus_notes c
  WHERE c.owner_id = $1 AND c.genre = $2
    AND ($3::timestamptz IS NULL OR (c.created_at, c.id) < ($3::timestamptz, $4::uuid))
  UNION ALL
  SELECT up.leaf_id, p.id, p.parent_id, p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT sqlc.embed(n),
       (SELECT u.path_titles FROM up u WHERE u.leaf_id = n.id AND u.parent_id IS NULL LIMIT 1) AS path_titles
FROM corpus_notes n
WHERE n.owner_id = $1 AND n.genre = $2
  AND ($3::timestamptz IS NULL OR (n.created_at, n.id) < ($3::timestamptz, $4::uuid))
  AND ($6::text IS NULL OR $6::text = '' OR $6::text = ANY(n.tags))
ORDER BY n.created_at DESC, n.id DESC
LIMIT $5;

-- name: CountNoteDescendants :one
-- Exact recursive descendant count for one node — the delete-cascade warning
-- ("also deletes its N child entries"). On-demand (one user action), not per level.
WITH RECURSIVE sub AS (
  SELECT cn.id FROM corpus_notes cn
  WHERE cn.parent_id = $2 AND cn.owner_id = $1 AND cn.genre = $3
  UNION ALL
  SELECT n.id FROM corpus_notes n JOIN sub ON n.parent_id = sub.id
)
SELECT count(*) FROM sub;

-- name: GetNoteMetaByID :one
-- meta only (no body): for walking up to compute the tree-derived path / checking ACL, not for reading the body.
SELECT id, parent_id, title, published
FROM corpus_notes
WHERE id = $1 AND owner_id = $2 AND genre = $3;

-- name: ListNoteCardsByIDs :many
-- Page-pin join: pinned entries → card content (title + excerpt + published as a safety filter).
-- The caller reorders by the pin list, so no ORDER here.
-- body is also fetched: when the owner wrote no excerpt, the card's sentence is derived from the body (F-L-47).
-- There are at most a handful of pinned entries.
SELECT id, title, excerpt, body, published
FROM corpus_notes
WHERE owner_id = $1 AND id = ANY($2::uuid[]);

-- name: CountNoteStats :one
-- Sidebar footer counts: total entries / root entries / non-public (gated) entries. Pure aggregation, does not load the tree.
SELECT
  count(*) AS entries,
  count(*) FILTER (WHERE parent_id IS NULL) AS roots,
  count(*) FILTER (WHERE NOT published) AS gated
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2;

-- name: ListAllNoteMeta :many
-- Full meta (no body, no limit): for sitemap enumeration + the landing page's title→path index. No newest-N cap
-- —— sitemap / link resolution must see everything; missing one is an SEO bug / broken link. Includes updated_at for the sitemap <lastmod>.
SELECT id, parent_id, title, published, updated_at
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
ORDER BY created_at DESC;

-- name: ListAllOwnerNoteTitles :many
-- Cross-genre title→id index: `[[Title]]` can point at any entry of any genre in the owner's corpus. For note-ref
-- resolution (a [[Output Title]] inside a wiki body must also resolve to an edge). Full, no cap —— missing one is a broken link.
-- aliases are fetched too: an `[[alias]]` must also resolve to an edge; aliases are the same candidate set as title (same disambiguation rules).
SELECT id, title, genre, aliases FROM corpus_notes WHERE owner_id = $1;

-- name: QueryCorpusNotes :many
-- For the native standmeet-query: filter by genre/tag (empty string = no filter) and compute path_titles
-- along the parent chain in SQL (root→leaf), avoiding a per-row N+1 path walk. Returns only root-reached rows
-- (one row per match, with the full path).
-- leaf_published is carried up from the leaf: admission asks "is this entry itself published?" (the sole criterion
-- for the public identity), but by the time the path walk reaches the root the leaf's row is no longer in hand.
WITH RECURSIVE up AS (
  SELECT n.id AS leaf_id, n.genre AS leaf_genre, n.published AS leaf_published,
         n.id, n.parent_id,
         ARRAY[n.title]::text[] AS path_titles
  FROM corpus_notes n
  WHERE n.owner_id = $1
    AND ($2::text = '' OR n.genre = $2::text)
    AND ($3::text = '' OR $3::text = ANY(n.tags))
  UNION ALL
  SELECT up.leaf_id, up.leaf_genre, up.leaf_published, p.id, p.parent_id,
         p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT up.leaf_id AS id, up.leaf_genre AS genre, up.leaf_published AS published,
       up.path_titles
FROM up WHERE up.parent_id IS NULL;

-- name: GrepCorpusNotes :many
-- The scan surface for corpus_grep: every note of the owner, including body, with path computed along the parent chain in SQL.
--
-- **No LIMIT, and there never will be.** never-miss is the whole reason this tool exists: wherever the pattern is, it must be returned.
-- A cap would degrade it into "usually findable", which is exactly what the neighboring corpus_search already provides.
-- Whether the body matches is decided on the Go side (RE2, the same semantics as the pattern the owner wrote), not in SQL —— postgres's
-- POSIX regex is not the same dialect as RE2, so letting it pre-filter would make each of the two dialects miss a little.
WITH RECURSIVE up AS (
  SELECT n.id AS leaf_id, n.genre AS leaf_genre, n.body AS leaf_body,
         n.published AS leaf_published,
         n.id, n.parent_id, ARRAY[n.title]::text[] AS path_titles
  FROM corpus_notes n
  WHERE n.owner_id = $1
  UNION ALL
  SELECT up.leaf_id, up.leaf_genre, up.leaf_body, up.leaf_published, p.id, p.parent_id,
         p.title || up.path_titles
  FROM corpus_notes p JOIN up ON p.id = up.parent_id
)
SELECT up.leaf_id AS id, up.leaf_genre AS genre, up.leaf_body AS body,
       up.leaf_published AS published, up.path_titles
FROM up WHERE up.parent_id IS NULL;

-- name: ListAllNotesForExport :many
-- Vault export: all corp notes(any genre) with body/tree/publish — reverse-render into vault .md.
-- lang / aliases are fetched too (F-L-59): if the export omits them, exporting and re-importing flattens the
-- bilingual pairing and the resolution input for `[[alias]]` **on the real corpus**. The loss starts at this SELECT, not at rendering.
--
-- The sentence above was right, but only swept the two fields it named at the time ([[lesson-not-swept-to-neighbours]]).
-- The excerpt / css_classes / lang_labels columns have been in the database all along, and this SELECT never fetched them,
-- so the export wrote none of them —— the owner syncing down loses them (F-L-67).
--
-- obsidian_source_path: **which file in the vault this note came from**. The export needs it so layout is not changed:
-- a folder-note that is "the only thing in its folder" (`x/y/y.md`) has no child nodes on the tree, so the export would
-- write it as the sibling `x/y.md` —— the content is unchanged, but the mirror moved it on the owner's behalf (F-L-68, 22 such files in the real vault).
--
-- obsidian_frontmatter: the raw text of this note's frontmatter block in the vault. Keys the product does not recognize
-- (in the real vault: `langs` 596 files, `aliases-zh` 595 files, `owns` 33 files) live only here; without fetching it,
-- the export can only re-render by the dozen-or-so keys it does recognize, which amounts to deleting the rest.
SELECT id, genre, parent_id, title, body, tags, published, lang, aliases,
       excerpt, css_classes, lang_labels, obsidian_source_path, obsidian_frontmatter
FROM corpus_notes WHERE owner_id = $1
ORDER BY created_at;

-- name: GetNoteByIDAnyGenre :one
-- Fetch one corpus note by id (any genre), for indexing a single entry into search.
SELECT * FROM corpus_notes WHERE owner_id = $1 AND id = $2 LIMIT 1;

-- name: GetNoteByTitleAnyGenre :one
-- Vault-sync reconcile identity: the vault basename (== title) is unique per owner (check-links.sh
-- resolves [[x]] by basename vault-wide, so basenames must be unique). Match cross-genre so a
-- genre-move (wiki/x.md → subjectivity/x.md) updates the same row in place. Oldest-first is stable
-- across re-syncs; the rare name-clash precedence (folder-note wins) is resolved in the pipeline.
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND title = $2
ORDER BY created_at ASC
LIMIT 1;

-- name: GetNoteBySourcePath :one
-- Vault-sync reconcile identity by the file's vault-relative path. Used when the basename
-- (title) is NOT unique across the vault: two files can share a basename in different folders,
-- but a file has exactly one source path, so this claims the right row instead of rejecting the
-- collision. This is the schema's intended reconcile identity (corpus_notes_source_path_idx).
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND obsidian_source_path = $2
ORDER BY created_at ASC
LIMIT 1;

-- name: GetNoteByTitleInGenre :one
-- Vault-sync reconcile identity for a STRUCTURAL node (a folder placeholder: it has no file, so
-- obsidian_source_path is empty and GetNoteBySourcePath cannot tell one folder from another). Its
-- identity is (genre, title) — it IS a folder on its own tree. Needed when the title is ambiguous:
-- `raw/math/` and `wiki/math/` both exist in a real vault, and claiming across genres by title
-- drags one tree's folder into the other genre (F-L-61).
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = $2 AND title = $3
ORDER BY created_at ASC
LIMIT 1;

-- name: ListDuplicateNoteTitles :many
-- Titles this owner's corpus holds MORE THAN ONCE (across genres). GetNoteByTitleAnyGenre claims
-- the OLDEST row with a title, so when a title is not unique, claiming by title is a coin toss —
-- and the losing side is a note in another genre that the upload never mentioned (F-L-61). The
-- ambiguity is a property of the CORPUS, not of one upload: a two-file subset upload contains each
-- title once, so counting collisions inside the upload cannot see it.
SELECT lower(title)::text AS title FROM corpus_notes
WHERE owner_id = $1
GROUP BY lower(title)
HAVING count(*) > 1;

-- name: CreateNoteSync :one
-- Vault sync create: sets genre/parent/publish + the obsidian identity (source_path, imported_at=now).
-- inbox_source is the vault-source tag for genre='raw' ("obsidian:<path>"); empty for other genres.
INSERT INTO corpus_notes
  (owner_id, genre, parent_id, title, body, tags, published, obsidian_source_path, css_classes, inbox_source, excerpt, aliases, lang, lang_labels, obsidian_frontmatter, obsidian_imported_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
RETURNING *;

-- name: UpdateNoteSync :one
-- Vault sync update (reconcile): relocate (genre/parent may change on a move), refresh body/tags/publish/excerpt,
-- re-stamp the obsidian identity + inbox_source. Never touches rows absent from the batch (caller upserts per file).
UPDATE corpus_notes
SET genre = $3, parent_id = $4, body = $5, tags = $6, published = $7,
    obsidian_source_path = $8, css_classes = $9, inbox_source = $10, excerpt = $11,
    aliases = $12, lang = $13, lang_labels = $14, obsidian_frontmatter = $15,
    obsidian_imported_at = now(), updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: SearchNotes :many
-- Full keyword search (DB-side full-text); returns meta + snippet (not the full body), paginated. A natural-language
-- question matches any term via OR (' & '→' | ', to stop noise words like "tell"/"me" from jamming plainto's default AND);
-- ranked by ts_rank relevance.
--
-- **The snippet is taken from the match site (`ts_headline`), not the start of the body.** It used to be `left(body, 200)`,
-- but nearly every note in this vault opens with a `> [!i18n]` language-switch callout —— those 200 bytes are all markup,
-- leaving nothing after cleaning, so every row the owner searched had no excerpt (F-L-45). The match site also happens to answer
-- "why was this row found", which is exactly what a search result should say. `StartSel/StopSel` are set empty: no `<b>` markup,
-- because the excerpt must be renderable directly to a person (the F-L-42 family: raw markup must not leak to the UI).
-- **Both empty values must be quoted** (`StartSel=""`): written as `StartSel=,`, postgres treats the rest as the value,
-- so every matched term gets a `,StopSel=` printed in front of it —— case ⑤, caught red-handed on the real corpus while the guard
-- was not red, because it only asserted "excerpt is non-empty and contains the matched term", which that garbage also satisfied.
--
-- updated_at is fetched too —— it used not to be selected, yet the wiki/output mapping still rendered the zero value as
-- `1970-01-01T00:00:00Z` and shipped it (F-L-46).
-- Both the index and the excerpt go through `corpus_searchable(body)` (defined in schema.sql): in the vault's i18n contract, that one
-- language-switch button line is a **presentation artifact**, not text the owner wrote. It used to go into both the index (searching for
-- "Chinese" would hit every multilingual note, even one without a single Chinese character in its body) and the excerpt (every excerpt
-- started with the switcher labels, e.g. an `EN` / Chinese-label button) —— UX-78.
-- Both places must use the same expression: cleaning only the excerpt would be worse — you would find it but not see why.
SELECT id, parent_id, title, published, updated_at,
       ts_headline('english', corpus_searchable(body),
         replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery,
         'StartSel="",StopSel="",MaxWords=28,MinWords=12,MaxFragments=1'
       ) AS snippet
FROM corpus_notes
WHERE owner_id = $1 AND genre = $2
  AND to_tsvector('english',
        title || ' ' || corpus_searchable(body) || ' ' || array_to_string(tags, ' '))
      @@ replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery
ORDER BY ts_rank(
        to_tsvector('english',
          title || ' ' || corpus_searchable(body) || ' ' || array_to_string(tags, ' ')),
        replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery
      ) DESC, updated_at DESC
LIMIT $4 OFFSET $5;

-- name: GetNoteCssClasses :one
-- cssclasses (per-note presentation hook). Attached to CorpusEntry at corpus_read time; cross-genre, by id.
SELECT css_classes FROM corpus_notes WHERE id = $1 AND owner_id = $2;

-- name: GetNoteLang :one
-- The two frontmatter fields multilingual rendering needs: the identity language + the switcher labels. The language **set**
-- is not here —— it is inferred from the language faces in the body, and storing a copy would drift from the body. Same shape as cssclasses: attached once at read time.
SELECT lang, lang_labels FROM corpus_notes WHERE id = $1 AND owner_id = $2;

-- name: PruneAbsentVaultNotes :execrows
-- F-L-6: an AUTHORITATIVE (whole-vault) sync makes the corpus EQUAL the vault — a note deleted from
-- the vault must disappear from the corpus, or "sync" only ever grows and re-syncing can never clean
-- a ghost. The vault is the SINGLE LIVE SOURCE (see the vault-ingestion decision), so there is no
-- "who wins": sync means the destination equals the source. A web edit does NOT pin a note against
-- its own vault — to keep web work, export it back to the vault first, then sync.
--   * obsidian_imported_at IS NOT NULL —— only vault-imported rows. Notes authored on the web or
--     pushed via the service handle were never vault-managed, so their absence from the upload
--     carries no instruction; the vault is not their source.
--   * id <> ALL(keep) —— everything reconciled this run survives.
-- note_refs (src_id/dst_id) and child rows cascade via FK, so a pruned subtree cleans up after itself.
DELETE FROM corpus_notes
WHERE owner_id = $1
  AND obsidian_imported_at IS NOT NULL
  AND NOT (id = ANY($2::uuid[]));

-- name: SetNoteHero :one
-- The hero area —— any corpus note of any genre can have one. It is not "an image": the design is the image + the sentence
-- laid over it + the hue, all three together (see the app's Cover component). The three columns have always been on this shared
-- table, but only the writing path used to write them, so "every genre can have a hero" held in the data but not in the code.
--
-- All three columns written at once: the caller first reads back the current values, overwrites only the ones given this time,
-- then writes the whole set back. This way "fields not mentioned" are not wiped out inadvertently —— corpus.update's existing
-- callers pass no hero field at all.
UPDATE corpus_notes
SET cover_image_asset_id = $3, cover_headline = $4, cover_hue = $5, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, cover_image_asset_id, cover_headline, cover_hue;

-- name: GetNoteHero :one
-- The asset-related items on a note: the body (with its standmeet-asset references) and the hero trio.
-- Cross-genre, by id —— assets are genre-agnostic.
SELECT body, cover_image_asset_id, cover_headline, cover_hue
FROM corpus_notes WHERE id = $1 AND owner_id = $2;
