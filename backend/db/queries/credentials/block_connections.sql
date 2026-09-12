-- block_connections.sql —— read/write of one block's connection to whatever is outside:
-- credentials, tokens, whether it is connected, and which supplier is live for a seam.
--
-- One table for any kind of block and any seam. The block's DEFINITION is not here — a
-- built-in's is `blocks/<id>/manifest.yaml`, an owner-installed one's is `installed_blocks`.

-- name: UpsertBlockCredentials :one
-- Store/overwrite one block's credentials (owner-supplied app creds / apiKey / smtp config).
-- seam/kind are set on first write.
--
-- connected_at is decided by `reset_connected`, **not cleared unconditionally** (F-C-30):
-- §3 D-5 requires "changing identity/credentials must re-verify" —— that rule should fire only when something
-- **changed**. But the first thing the panel's Connect does is POST /credentials, so "connected" is lost before
-- authorization even starts; the owner only has to reopen the card and re-save once (without touching a single
-- value) and a perfectly good connection shows as "not connected" while the token is still alive.
-- The caller compares the merged credentials against the original: pass true only when they truly changed.
INSERT INTO block_connections (
    owner_id, block_id, seam, kind, credentials_enc
)
VALUES (
    sqlc.arg(owner_id), sqlc.arg(block_id), sqlc.arg(seam),
    sqlc.arg(kind), sqlc.arg(credentials_enc)::bytea
)
ON CONFLICT (owner_id, block_id) DO UPDATE
SET credentials_enc = EXCLUDED.credentials_enc,
    seam = EXCLUDED.seam,
    kind = EXCLUDED.kind,
    connected_at = CASE
        WHEN sqlc.arg(reset_connected)::boolean THEN NULL
        ELSE block_connections.connected_at
    END,
    updated_at = now()
RETURNING *;

-- name: UpdateBlockTokens :one
-- OAuth gets its first token, or the refresh path gets a new access_token. First token obtained → connected.
UPDATE block_connections
SET token_enc = sqlc.arg(token_enc)::bytea,
    token_expires_at = sqlc.arg(token_expires_at)::timestamptz,
    scopes = sqlc.arg(scopes)::jsonb,
    connected_at = COALESCE(connected_at, now()),
    updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id)
RETURNING *;

-- name: MarkBlockConnected :execrows
-- A protocol block verified (no oauth dance) → mark connected.
-- **:execrows, not :exec** —— this row is created by the "store credentials" step. When the owner does not have
-- it yet, this UPDATE matches 0 rows without erroring and the caller still returns connected:true —— a lie, and
-- one that every fresh install hits. The row count is the only receipt this write has; the caller must read it.
UPDATE block_connections
SET connected_at = COALESCE(connected_at, now()), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id);

-- name: ClearBlockTokens :exec
-- soft disconnect: wipe token + connected + active, keep credentials (one-click reconnect without re-entering).
UPDATE block_connections
SET token_enc = '\x'::bytea, token_expires_at = NULL,
    connected_at = NULL, active = false, updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id);

-- name: SetActiveSupplier :many
-- Only one supplier per seam at a time: set the target active, set the rest of the seam inactive.
-- **RETURNING is the receipt.** The row count proves nothing here: the update spans the whole seam, and when the
-- target row is not among them the rest are all set inactive while the count stays > 0 —— the result of "activate" is
-- that **this seam has no supplier at all**. So the receipt must be the names: the caller checks whether the target
-- block_id is in the returned set.
UPDATE block_connections
SET active = (block_id = sqlc.arg(block_id)::text), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND seam = sqlc.arg(seam)
RETURNING block_id;

-- name: GetBlockConnection :one
SELECT * FROM block_connections
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id);

-- name: ListBlockConnectionsByOwner :many
SELECT * FROM block_connections
WHERE owner_id = sqlc.arg(owner_id)
ORDER BY seam, block_id;

-- name: ListBlockConnectionsBySeam :many
SELECT * FROM block_connections
WHERE owner_id = sqlc.arg(owner_id) AND seam = sqlc.arg(seam)
ORDER BY block_id;

-- name: DeleteBlockConnection :exec
DELETE FROM block_connections
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id);

-- name: InsertUploadedBlock :one
-- Upload an openapi block (owner pastes spec + JSONata binding in the UI): create the row and store the manifest
-- (spec/binding/auth_scheme), not connected on first write. seam/kind are set by the binding.
INSERT INTO block_connections (
    owner_id, block_id, seam, kind, spec, binding, auth_scheme, protocol,
    expose_as_agent_tools, title
)
VALUES (
    sqlc.arg(owner_id), sqlc.arg(block_id), sqlc.arg(seam),
    sqlc.arg(kind), sqlc.arg(spec)::bytea, sqlc.arg(binding)::bytea,
    sqlc.arg(auth_scheme), sqlc.arg(protocol), sqlc.arg(expose_as_agent_tools),
    sqlc.arg(title)
)
RETURNING *;

-- name: UpdateUploadedBlock :exec
-- Edit the spec/binding/auth_scheme of an existing uploaded block (owner edits the spec in the UI → reassemble +
-- re-derive the credentials form). After changing the auth type the credentials must be re-entered, so clear
-- connected_at (reconnect). The seam may change with it.
UPDATE block_connections
SET spec = sqlc.arg(spec)::bytea, binding = sqlc.arg(binding)::bytea,
    seam = sqlc.arg(seam), auth_scheme = sqlc.arg(auth_scheme),
    expose_as_agent_tools = sqlc.arg(expose_as_agent_tools),
    title = sqlc.arg(title),
    connected_at = NULL, updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id);

-- name: GetBlockManifest :one
-- Fetch a block's stored manifest fields (uploaded blocks have spec/binding; protocol blocks have protocol).
SELECT seam, kind, spec, binding, auth_scheme, protocol, expose_as_agent_tools
FROM block_connections
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id);

-- name: ListUploadedBlocks :many
-- Reload on boot: all owner-authored blocks (openapi with a spec + kind=protocol blocks), across owners
-- (v1 single owner; the supplier table keys by block_id). A built-in has an empty spec and kind!=protocol,
-- so it is excluded.
SELECT DISTINCT ON (block_id)
    block_id, seam, kind, spec, binding, auth_scheme, protocol, expose_as_agent_tools
FROM block_connections
WHERE length(spec) > 0 OR kind = 'protocol'
ORDER BY block_id, updated_at DESC;

-- name: DeleteUploadedBlock :exec
-- Delete an owner-authored block (row delete). The seam it supplied goes empty (the seam store reads
-- nothing → every consumer re-gates).
DELETE FROM block_connections
WHERE owner_id = sqlc.arg(owner_id) AND block_id = sqlc.arg(block_id);
