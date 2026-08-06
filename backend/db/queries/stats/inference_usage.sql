-- name: RecordInferenceUsage :exec
-- #106 每次 owner-key LLM 调用记一行。metered = 这一趟算在某箱油的账上(#7):
-- 挂了表的 role + 指得到的 provider,两个条件都成立才是 true,由调用方判定。
INSERT INTO inference_usage (
    owner_id, model, input_tokens, output_tokens, cached_tokens, provider_id, metered
)
VALUES ($1, $2, $3, $4, $5, $6, $7);

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

-- name: SumMeteredUsageSince :one
-- 一箱油自加油那一刻起花掉的量。没有计数器列 —— 跟 turn 配额一样读时求和。
SELECT COALESCE(sum(input_tokens + output_tokens), 0)::bigint
FROM inference_usage
WHERE provider_id = $1 AND metered AND created_at >= $2;

-- name: DeleteInferenceUsageOlderThan7Days :exec
-- 7 天小表:清老行(查询本就只看 7 天,清理只为不让表无限涨)。
--
-- **但计量行不能一起清**:看板只看 7 天,油量却是"从加油那次到现在"的累计。把过了 7 天的
-- 计量行删掉,等于油自己长回来 —— 一个不用加油的油箱。所以只留还在当前那一箱账期里的:
-- 上次加油之前的计量行已经不参与任何求和,跟普通老行一样删。
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
