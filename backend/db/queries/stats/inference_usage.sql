-- name: RecordInferenceUsage :exec
-- #106 每次 owner-key LLM 调用记一行。
INSERT INTO inference_usage (owner_id, model, input_tokens, output_tokens)
VALUES ($1, $2, $3, $4);

-- name: SummarizeInferenceUsage7Day :many
-- 近 7 天按天×model 聚合(call 数 + token 合计)。新 → 老。
SELECT date_trunc('day', created_at)::date AS day,
       model,
       count(*)::bigint            AS calls,
       sum(input_tokens)::bigint   AS input_tokens,
       sum(output_tokens)::bigint  AS output_tokens
FROM inference_usage
WHERE owner_id = $1 AND created_at >= now() - interval '7 days'
GROUP BY day, model
ORDER BY day DESC, model;

-- name: DeleteInferenceUsageOlderThan7Days :exec
-- 7 天小表:boot 时清老行(查询本就只看 7 天,清理只为不让表无限涨)。
DELETE FROM inference_usage WHERE created_at < now() - interval '7 days';
