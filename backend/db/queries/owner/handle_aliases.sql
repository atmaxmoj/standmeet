-- name: GetOwnerByHandleAlias :one
-- Used when the handle isn't on owners.handle: after an owner renames, the old handle enters the alias table.
SELECT o.id, o.email, o.handle, o.full_name, o.location,
       o.byoai_enabled, o.byoai_providers, o.byoai_public_blurb, o.created_at
FROM owners o
JOIN handle_aliases a ON a.owner_id = o.id
WHERE a.handle = $1;

-- name: AddHandleAlias :exec
-- When an owner changes handle, write the old handle into the alias table. Conflicts (the old
-- handle was already aliased / taken by another owner) are ignored -- the alias just needs to be unique.
INSERT INTO handle_aliases (handle, owner_id)
VALUES ($1, $2)
ON CONFLICT (handle) DO NOTHING;

-- name: UpdateOwnerHandle :one
-- Set owners.handle to the new value, returning the updated row for GetByID-shaped callers.
UPDATE owners
SET handle = $2
WHERE id = $1
RETURNING id, email, handle, full_name, location,
          byoai_enabled, byoai_providers, byoai_public_blurb, created_at;
