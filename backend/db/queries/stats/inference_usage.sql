-- name: RecordInferenceUsage :exec
-- #106 record one row per owner-key LLM call. metered = this call counts against a gas tank's ledger (#7):
-- a metered role + a resolvable provider, true only when both hold, decided by the caller.
INSERT INTO inference_usage (
    owner_id, model, input_tokens, output_tokens, cached_tokens, provider_id, metered, feature
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: SummarizeInferenceUsageByFeature7Day :many
-- The last 7 days by feature × model: which feature spent what, on which model.
SELECT feature,
       model,
       count(*)::bigint            AS calls,
       sum(input_tokens)::bigint   AS input_tokens,
       sum(output_tokens)::bigint  AS output_tokens
FROM inference_usage
WHERE owner_id = $1 AND created_at >= now() - interval '7 days'
GROUP BY feature, model
ORDER BY feature, model;

-- name: DefaultProviderModel :one
-- The owner's default provider: what a role / code without its own, and every plugin, runs on.
SELECT label, model FROM owner_providers WHERE owner_id = $1 AND is_default;

-- name: RoleProviderModels :many
-- Each role and the provider it names (NULL label = none: it falls to the default), with how many
-- live codes assume it.
SELECT r.name,
       p.label AS provider_label,
       p.model AS provider_model,
       (SELECT count(*) FROM access_codes c
        WHERE c.assumed_role_id = r.id AND c.status = 'active')::bigint AS codes
FROM roles r
LEFT JOIN owner_providers p ON p.id = r.provider_id
WHERE r.owner_id = $1
ORDER BY r.name;

-- name: CodeProviderModels :many
-- Live codes that name their own provider (a code outranks its role).
SELECT c.code, p.label AS provider_label, p.model AS provider_model
FROM access_codes c
JOIN owner_providers p ON p.id = c.provider_id
WHERE c.owner_id = $1 AND c.status = 'active'
ORDER BY c.code;

-- name: SummarizeInferenceUsage7Day :many
-- Aggregate the last 7 days by day × model (call count + token totals). Newest → oldest.
SELECT date_trunc('day', created_at)::date AS day,
       model,
       count(*)::bigint            AS calls,
       sum(input_tokens)::bigint   AS input_tokens,
       sum(output_tokens)::bigint  AS output_tokens
FROM inference_usage
WHERE owner_id = $1 AND created_at >= now() - interval '7 days'
GROUP BY day, model
ORDER BY day DESC, model;

-- name: SumMeteredUsageSince :one
-- How much a gas tank has spent since the moment it was filled. No counter column —— summed at read time, like the turn quota.
SELECT COALESCE(sum(input_tokens + output_tokens), 0)::bigint
FROM inference_usage
WHERE provider_id = $1 AND metered AND created_at >= $2;

-- name: DeleteInferenceUsageOlderThan7Days :exec
-- 7-day small table: purge old rows (the queries only look back 7 days anyway; cleanup only keeps the table from growing forever).
--
-- **But metered rows cannot be purged together**: the dashboard only looks at 7 days, yet gas usage is the cumulative total
-- "from the last fill to now". Deleting metered rows older than 7 days lets the gas grow back on its own —— a tank that never
-- needs filling. So keep only those still within the current tank's billing period: metered rows before the last fill no longer
-- participate in any sum, so delete them like ordinary old rows.
DELETE FROM inference_usage u
WHERE u.created_at < now() - interval '7 days'
  AND NOT (
      u.metered
      AND EXISTS (
          SELECT 1 FROM owner_providers p
          WHERE p.id = u.provider_id
            AND p.gas_tokens IS NOT NULL
            AND u.created_at >= COALESCE(p.gas_filled_at, 'epoch'::timestamptz)
      )
  );
