-- feature_models.sql —— per-owner feature→model overrides (owner_feature_models), with an optional
-- role scope. A feature pins the model every call of it runs on, overriding the resolved provider's
-- own model while reusing its key. role_id='' is the feature's global pin; a role id overrides a given
-- feature for that role.

-- ResolveFeatureModel —— the cascade read: the role's override of this feature if present, else the
-- feature's global pin, else no row. $2 is the role id ('' when the caller has no role). role_id DESC
-- puts the non-empty (role) row ahead of the global '' row.
-- name: ResolveFeatureModel :one
SELECT model FROM owner_feature_models
WHERE owner_id = $1 AND feature = $3 AND role_id IN ($2, '')
ORDER BY role_id DESC
LIMIT 1;

-- name: SetFeatureModel :exec
INSERT INTO owner_feature_models (owner_id, role_id, feature, model)
VALUES ($1, $2, $3, $4)
ON CONFLICT (owner_id, role_id, feature) DO UPDATE SET model = EXCLUDED.model;

-- name: DeleteFeatureModel :exec
DELETE FROM owner_feature_models WHERE owner_id = $1 AND role_id = $2 AND feature = $3;

-- name: ListFeatureModels :many
SELECT role_id, feature, model FROM owner_feature_models
WHERE owner_id = $1 ORDER BY feature, role_id;
