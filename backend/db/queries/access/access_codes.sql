-- name: CreateAccessCode :one
-- A.3-IAM-5: every code must carry an assumed_role_id. Legacy fields like
-- corpus_permissions / granted_skills are dropped in commit 5; ACL / capability
-- gating is all inferred from the role.
INSERT INTO access_codes (
    owner_id, code, label, purpose, ghosts,
    expires_at, max_turns_per_session,
    assumed_role_id, max_members, prompt_id, inline_prompt, provider_id,
    limit_per_period
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: CountCodeTurnsSince :one
-- How many turns this code has accumulated since a given moment (across all of this code's
-- sessions). The per-period rate gate uses it to count the volume within the window.
-- One dialog = one turn.
SELECT count(*) FROM dialogs d
JOIN conversations c ON c.id = d.conversation_id
WHERE c.code_id = $1 AND d.created_at >= $2;

-- name: UpdateAccessCodeRole :one
-- Admin "reassign role". The new role must belong to the same owner (caller has validated this).
UPDATE access_codes
SET assumed_role_id = $3
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: GetAccessCode :one
-- **Do not add lower() here**: the `code` column is `citext` (see schema.sql:245), so the
-- comparison is already case-insensitive. I once assumed "?code= won't get in because the code
-- lookup compares byte-for-byte" and changed it to `lower(code)=lower($1)` -- that was wrong,
-- and harmful: it prevents the UNIQUE index on citext from being used. **The column type is the
-- rule**; don't restate it in the query.
SELECT * FROM access_codes WHERE code = $1 AND status = 'active';

-- name: GetAccessCodeWithPage :one
-- Same as GetAccessCode, plus the slug of **which page this code opens**.
-- The landing decision must be made at the codes/intro moment (the frontend already calls this
-- when a visitor arrives with a code), and the slug lives on the pages table -- fetching it via a
-- join at the SQL layer means the visitor path need not cross domains to ask the owner domain.
-- Empty string = not bound, opens the default visitor conversation.
SELECT ac.*, COALESCE(cp.slug, '')::text AS microsite_slug
FROM access_codes ac
LEFT JOIN microsites cp ON cp.id = ac.microsite_id AND cp.status != 'deleted'
WHERE ac.code = $1 AND ac.status = 'active';

-- name: GetAccessCodeAnyStatus :one
-- No status filter: lets the repo distinguish "this code doesn't exist" from "this code was
-- revoked". Querying only by status='active' makes both cases no-rows, collapsing the visitor's
-- rejection into a single message -- but the next step for these two people is opposite
-- (paste it again / go request a new one) -- F-D-6.
SELECT * FROM access_codes WHERE code = $1;

-- name: GetAccessCodeByID :one
SELECT * FROM access_codes WHERE id = $1;

-- name: ListAccessCodesByOwner :many
SELECT * FROM access_codes WHERE owner_id = $1 ORDER BY created_at DESC;

-- name: ListAccessCodesWithPageByOwner :many
-- Same as above, plus **which page this code opens**. The binding is one fact, and both panels
-- read the same place: the code side sees the page, the page side sees the code
-- (ListMicrositesByOwner carries bound_codes).
-- LEFT JOIN: an unbound code has an empty slug, which is "opens the default visitor conversation",
-- not missing data.
SELECT ac.*, COALESCE(cp.slug, '')::text AS microsite_slug
FROM access_codes ac
LEFT JOIN microsites cp ON cp.id = ac.microsite_id AND cp.status != 'deleted'
WHERE ac.owner_id = $1
ORDER BY ac.created_at DESC;

-- name: SetAccessCodeMicrosite :one
-- Bind/unbind. $3 NULL = unbind, the code falls back to the default landing.
-- A code has at most one page -- this is a column, not a relation table, so "at most one" is
-- guaranteed structurally, not by validation.
UPDATE access_codes
SET microsite_id = $3
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- RevokeAccessCode was deleted: it was `:exec`, which discards the row count, so a revoke that
-- matched nothing came back as success. CodeRepo.Revoke hand-writes the same UPDATE precisely to
-- read the CommandTag, and has been the only caller for a long time — leaving the generated one
-- around is an invitation to call the version that cannot tell you it did nothing.

-- name: UpdateAccessCodeQuotas :one
UPDATE access_codes
SET max_turns_per_session = $3, max_members = $4
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: SetAccessCodeGhostEvidence :one
-- F-A-10 per-code override: NULL = inherit the role's switch; true/false = this code overrides explicitly.
UPDATE access_codes
SET require_ghost_evidence = $3
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: CountCodeMembers :one
-- Used to enforce max_members: how many distinct names (members) this code already has.
SELECT count(*) FROM code_members WHERE code_id = $1;

-- name: LockCodeForMemberInsert :one
-- First step of the seat gate: a **separate statement** that locks this code and reads back max_members.
--
-- Why it must be a separate statement: under READ COMMITTED, all reads within one statement share
-- the snapshot taken **at statement start**. If `FOR UPDATE` and `count(*)` are put in the same
-- statement (a CTE), a second concurrent request does block on the lock, but after acquiring it its
-- count still comes from the old snapshot -- it can't see the row the other just committed, so it
-- admits anyway. The lock serialized, the count did not (the first version of F-D-5 was exactly
-- this, and its comment still claimed "no gap").
-- Split into two statements, the count is a new statement that starts **after** the lock -- a new
-- snapshot that sees the committed member.
SELECT max_members FROM access_codes WHERE id = $1 FOR UPDATE;

-- name: GetCodeMemberByID :one
-- Fetch by member id (the client stored member_id and resumes by id on return; anonymous users
-- especially). Scoped by code_id to prevent cross-code leakage.
SELECT * FROM code_members WHERE id = $1 AND code_id = $2;

-- name: CreateCodeMember :one
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: MemberExistsByName :one
-- Same name = resume session, does not consume a new seat. Like the count, it must be read
-- separately after the lock.
SELECT EXISTS (SELECT 1 FROM code_members WHERE code_id = $1 AND display_name = $2);

-- name: UpsertCodeMember :one
-- The actual persist step. Whether a seat is available is decided by the caller within the same
-- transaction, after acquiring the row lock -- so this query no longer carries a gate of its own
-- (carrying one would be useless anyway; see the LockCodeForMemberInsert comment).
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
VALUES ($1, $2, $3, $4)
ON CONFLICT (code_id, display_name) DO UPDATE SET last_seen_at = now()
RETURNING *;

-- GetOrCreateCodeMember -- create/resume a member, **enforcing the seat cap within the same statement**.
--
-- WARNING: this is **no longer a seat gate** (it can't hold; see LockCodeForMemberInsert). It stays
-- because there's still a call path without a cap; the capped path goes through the transactional
-- version in the repo.
--
-- The cap used to be compared in the usecase against a list read earlier, with a bare INSERT: two
-- sessions arriving at once both read len=9, both judged 9 < 10, both inserted, so a code capped at
-- 10 could grow to 11 people and then jam at "full and one over" (F-D-5, measured: 12 concurrent
-- against a code capped at 5 -> 6 persisted). A sequentially-run usecase never sees this.
--
-- `FOR UPDATE` locks the access_codes row: a concurrent second statement blocks until the first
-- commits, then re-reads the count, so there is no gap between the count and the insert. Admitting a
-- same name is a **session resume**, it does not consume a new seat.
-- Full -> no row inserted -> :one returns no-rows, and the caller reports "full" from that. The row
-- count is the receipt.
-- name: GetOrCreateCodeMember :one
WITH locked AS (
    SELECT max_members FROM access_codes WHERE id = $1 FOR UPDATE
), allowed AS (
    SELECT 1 FROM locked
    WHERE max_members IS NULL
       OR max_members <= 0
       OR EXISTS (SELECT 1 FROM code_members WHERE code_id = $1 AND display_name = $2)
       OR (SELECT count(*) FROM code_members WHERE code_id = $1) < max_members
)
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
SELECT $1, $2, $3, $4 FROM allowed
ON CONFLICT (code_id, display_name) DO UPDATE SET last_seen_at = now()
RETURNING *;

-- name: GetCodeMemberByName :one
SELECT * FROM code_members WHERE code_id = $1 AND display_name = $2;

-- name: ListCodeMembers :many
SELECT * FROM code_members WHERE code_id = $1 ORDER BY last_seen_at DESC NULLS LAST;

-- name: TouchCodeMember :exec
UPDATE code_members SET last_seen_at = now() WHERE id = $1;

-- name: ClearCodeWaypoints :exec
DELETE FROM code_waypoints WHERE code_id = $1;

-- name: AttachCodeWaypoint :exec
-- Insert one at a time (small count + evidence_refs is per-row jsonb), same as AttachRoleWaypoint.
INSERT INTO code_waypoints (code_id, waypoint_id, description, weight, evidence_refs, is_terminal)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (code_id, waypoint_id) DO NOTHING;

-- name: ListCodeWaypoints :many
-- This code's waypoint **override layer** (excludes the inherited role's); merged in domain.MergeWaypoints.
SELECT waypoint_id, description, weight, evidence_refs, is_terminal
FROM code_waypoints WHERE code_id = $1 ORDER BY weight DESC, waypoint_id ASC;

-- name: ClearCodeCorpusDenials :exec
DELETE FROM code_corpus_denials WHERE code_id = $1;

-- name: AttachCodeCorpusDenial :exec
INSERT INTO code_corpus_denials (code_id, uri_pattern)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: ListCodeCorpusDenials :many
-- The URI globs this code revokes (a pure subtraction layer; the role's allow list minus this =
-- what this code can actually read).
SELECT uri_pattern FROM code_corpus_denials WHERE code_id = $1 ORDER BY uri_pattern ASC;
