-- name: GetInstanceSettings :one
SELECT * FROM instance_settings WHERE id = 1;

-- 把当前 setup_token_hash 写进 instance_settings；启动时调一次，让 setup
-- token 真生效。
-- name: SetSetupTokenHash :exec
UPDATE instance_settings
SET setup_token_hash = $1
WHERE id = 1;

-- 原子 claim：当且仅当 is_claimed=false 且 setup_token_hash 匹配时 mark
-- claimed + 清 token。返回更新后的行；调用方据此判断是否成功（受影响 0
-- 行即 token 错或已 claimed）。
-- name: TryClaimInstance :one
UPDATE instance_settings
SET is_claimed = true,
    setup_token_hash = NULL
WHERE id = 1
  AND is_claimed = false
  AND setup_token_hash = $1
RETURNING *;
