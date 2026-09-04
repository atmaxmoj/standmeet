-- owner_connectors.sql —— #155 read/write of unified connector connection state (one table for any kind/category).

-- name: UpsertConnectorCredentials :one
-- Store/overwrite one connector's credentials (owner-supplied app creds / apiKey / smtp config). category/kind
-- are set on first write.
--
-- connected_at is decided by `reset_connected`, **not cleared unconditionally** (F-C-30):
-- §3 D-5 requires "changing identity/credentials must re-verify" —— that rule should fire only when something
-- **changed**. But the first thing the panel's Connect does is POST /credentials, so "connected" is lost before
-- authorization even starts; the owner only has to reopen the card and re-save once (without touching a single
-- value) and a perfectly good connection shows as "not connected" while the token is still alive.
-- The caller compares the merged credentials against the original: pass true only when they truly changed.
INSERT INTO owner_connectors (
    owner_id, connector_id, category, kind, credentials_enc
)
VALUES (
    sqlc.arg(owner_id), sqlc.arg(connector_id), sqlc.arg(category),
    sqlc.arg(kind), sqlc.arg(credentials_enc)::bytea
)
ON CONFLICT (owner_id, connector_id) DO UPDATE
SET credentials_enc = EXCLUDED.credentials_enc,
    category = EXCLUDED.category,
    kind = EXCLUDED.kind,
    connected_at = CASE
        WHEN sqlc.arg(reset_connected)::boolean THEN NULL
        ELSE owner_connectors.connected_at
    END,
    updated_at = now()
RETURNING *;

-- name: UpdateConnectorTokens :one
-- OAuth gets its first token, or the refresh path gets a new access_token. First token obtained → connected.
UPDATE owner_connectors
SET token_enc = sqlc.arg(token_enc)::bytea,
    token_expires_at = sqlc.arg(token_expires_at)::timestamptz,
    scopes = sqlc.arg(scopes)::jsonb,
    connected_at = COALESCE(connected_at, now()),
    updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id)
RETURNING *;

-- name: MarkConnectorConnected :execrows
-- protocol connector verified (no oauth dance) → mark connected.
-- **:execrows, not :exec** —— this row is created by the "store credentials" step. When the owner does not have
-- it yet, this UPDATE matches 0 rows without erroring and the caller still returns connected:true —— a lie, and
-- one that every fresh install hits. The row count is the only receipt this write has; the caller must read it.
UPDATE owner_connectors
SET connected_at = COALESCE(connected_at, now()), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ClearConnectorTokens :exec
-- soft disconnect: wipe token + connected + active, keep credentials (one-click reconnect without re-entering).
UPDATE owner_connectors
SET token_enc = '\x'::bytea, token_expires_at = NULL,
    connected_at = NULL, active = false, updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: SetActiveConnector :many
-- Only one active per category slot at a time: set the target active, set the rest of the category inactive (§9 slot rule).
-- **RETURNING is the receipt.** The row count proves nothing here: the update spans the whole category, and when the
-- target row is not among them the rest are all set inactive while the count stays > 0 —— the result of "activate" is
-- that **this category has no active at all**. So the receipt must be the names: the caller checks whether the target
-- connector_id is in the returned set.
UPDATE owner_connectors
SET active = (connector_id = sqlc.arg(connector_id)::text), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND category = sqlc.arg(category)
RETURNING connector_id;

-- name: GetConnector :one
SELECT * FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ListConnectorsByOwner :many
SELECT * FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id)
ORDER BY category, connector_id;

-- name: ListConnectorsByCategory :many
SELECT * FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND category = sqlc.arg(category)
ORDER BY connector_id;

-- name: DeleteConnector :exec
DELETE FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: InsertUploadedConnector :one
-- Upload an openapi connector (owner pastes spec + JSONata binding in the UI): create the row and store the manifest
-- (spec/binding/auth_scheme), not connected on first write. category/kind are set by the binding.
INSERT INTO owner_connectors (
    owner_id, connector_id, category, kind, spec, binding, auth_scheme, protocol,
    expose_as_agent_tools, title
)
VALUES (
    sqlc.arg(owner_id), sqlc.arg(connector_id), sqlc.arg(category),
    sqlc.arg(kind), sqlc.arg(spec)::bytea, sqlc.arg(binding)::bytea,
    sqlc.arg(auth_scheme), sqlc.arg(protocol), sqlc.arg(expose_as_agent_tools),
    sqlc.arg(title)
)
RETURNING *;

-- name: UpdateUploadedConnector :exec
-- Edit the spec/binding/auth_scheme of an existing uploaded connector (owner edits the spec in the UI → reassemble +
-- re-derive the credentials form). After changing the auth type the credentials must be re-entered, so clear
-- connected_at (reconnect). category may change with it.
UPDATE owner_connectors
SET spec = sqlc.arg(spec)::bytea, binding = sqlc.arg(binding)::bytea,
    category = sqlc.arg(category), auth_scheme = sqlc.arg(auth_scheme),
    expose_as_agent_tools = sqlc.arg(expose_as_agent_tools),
    title = sqlc.arg(title),
    connected_at = NULL, updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: GetConnectorManifest :one
-- Fetch a connector's stored manifest fields (uploaded connectors have spec/binding; protocol connectors have protocol).
SELECT category, kind, spec, binding, auth_scheme, protocol, expose_as_agent_tools
FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ListUploadedConnectors :many
-- Reload on boot: all owner-authored connectors (openapi with a spec + kind=protocol connectors), across owners
-- (v1 single owner; Hub keys by connector_id). Built-in connectors have empty spec and kind!=protocol, so they are excluded.
SELECT DISTINCT ON (connector_id)
    connector_id, category, kind, spec, binding, auth_scheme, protocol, expose_as_agent_tools
FROM owner_connectors
WHERE length(spec) > 0 OR kind = 'protocol'
ORDER BY connector_id, updated_at DESC;

-- name: DeleteUploadedConnector :exec
-- Delete an owner-authored connector (row delete). The category slot it filled goes empty (slot store reads nothing → cap re-gates).
DELETE FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);
