-- name: CreateOwner :one
INSERT INTO owners (email, password_hash, handle, full_name, public_url)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetOwnerByEmail :one
SELECT * FROM owners WHERE email = $1;

-- name: GetOwnerByID :one
SELECT * FROM owners WHERE id = $1;

-- name: GetOwnerByHandle :one
SELECT * FROM owners WHERE handle = $1;

-- name: CountOwners :one
SELECT COUNT(*) FROM owners;

-- name: GetFirstOwnerHandle :one
-- v1 单 owner instance：返回最早创建那位的 handle；app 根路径用来跳转。
SELECT handle FROM owners ORDER BY created_at ASC LIMIT 1;

-- name: UpdateOwnerBYOAI :one
UPDATE owners
SET byoai_enabled = $2,
    byoai_providers = $3,
    byoai_public_blurb = $4
WHERE id = $1
RETURNING *;

-- UpdateOwnerAIProvider was deleted with the four ai_* columns: an owner holds a *book* of
-- providers now (owner_providers.sql), one of them marked default. Writing "the owner's provider"
-- is writing one row of that book.

-- name: UpdateOwnerPublicURL :one
UPDATE owners
SET public_url = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerFullName :one
UPDATE owners
SET full_name = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerEmail :one
UPDATE owners
SET email = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerPasswordHash :one
UPDATE owners
SET password_hash = $2
WHERE id = $1
RETURNING *;

-- name: SetOwnerRecoveryHash :exec
-- #100: 存/换 recovery phrase 的 hash(明文只进邮件)。
UPDATE owners SET recovery_hash = $2 WHERE id = $1;

-- name: ClearOwnerRecoveryHash :exec
-- #100: recover 成功后作废(单次用)。
UPDATE owners SET recovery_hash = '' WHERE id = $1;

-- name: UpdateOwnerProfileTimezone :one
UPDATE owners
SET profile_timezone = $2
WHERE id = $1
RETURNING *;

-- name: GetOwnerPasswordHash :one
SELECT password_hash FROM owners WHERE id = $1;

-- name: SetPasswordResetToken :exec
-- 紧急 reset token：写 hash + 当前时间。每 owner 同时只允许一个 reset
-- token；旧的被新的覆盖（"重新跑命令"也是合法 UX）。
UPDATE owners SET password_reset_hash = $2, password_reset_at = NOW() WHERE id = $1;

-- name: GetFirstOwnerResetToken :one
-- single-owner self-host：reset 流程通过 sole owner 找回。返 owner_id + hash
-- + at 让 usecase 比对 + 检 TTL。表为空 → ErrNoRows，caller 翻 unauthorized。
SELECT id, password_reset_hash, password_reset_at FROM owners
ORDER BY created_at ASC LIMIT 1;

-- name: ClearPasswordResetToken :exec
-- reset 成功后清掉，让 token 一次性。
UPDATE owners SET password_reset_hash = ''::bytea, password_reset_at = NULL WHERE id = $1;

-- name: GetOwnerCSS :one
-- owner 自定义 CSS(已 sanitize+scope 的安全版本)。
SELECT custom_css FROM owners WHERE id = $1;

-- name: SetOwnerCSS :exec
-- 存 owner CSS(caller 传入的应已是 sanitize+scope 后的安全版本)。
UPDATE owners SET custom_css = $2 WHERE id = $1;

-- name: RecordVaultImport :execrows
-- UX-62：把「上一次 vault 导入」记下来 —— 导入是定义这个产品 ground truth 的操作，
-- 而在此之前「它发生过没有」在库里没有落点，屏幕上那行计数刷新就没了。
-- :execrows 而不是 :exec —— 命中 0 行必须说得出来（[[write-with-no-receipt]]）。
UPDATE owners
SET last_vault_import_at = now(),
    last_vault_import_new = $2,
    last_vault_import_updated = $3,
    last_vault_import_skipped = $4,
    last_vault_import_deleted = $5
WHERE id = $1;

-- name: SetOwnerPendingEmail :one
-- 待确认的改邮箱。身份**不动** —— 只有点开信里的链接才换。
-- 第二次请求直接覆盖：两个都能用的话，owner 以为改成了后一个，而某个旧标签页
-- 一点就把身份送去了前一个。
UPDATE owners
SET pending_email = $2, pending_email_token_hash = $3, pending_email_expires_at = $4
WHERE id = $1
RETURNING *;

-- name: ClearOwnerPendingEmail :one
-- owner 反悔。:one + RETURNING 才知道到底清没清到行(:exec 把行数扔了)。
UPDATE owners
SET pending_email = NULL, pending_email_token_hash = '', pending_email_expires_at = NULL
WHERE id = $1
RETURNING *;

-- name: ConfirmOwnerPendingEmail :one
-- 一次性 + 未过期，全在这一条语句里判：命中 0 行 = token 不对 / 已过期 / 已用过。
-- 换完就把三列清空 —— 可重放的确认链接等于把身份挂在一封旧邮件上。
UPDATE owners
SET email = pending_email,
    pending_email = NULL,
    pending_email_token_hash = '',
    pending_email_expires_at = NULL
WHERE pending_email_token_hash = $1
  AND pending_email_token_hash <> ''
  AND pending_email IS NOT NULL
  AND pending_email_expires_at > now()
RETURNING *;

-- name: GetOwnerByPendingToken :one
-- 只为了分辨「过期」和「压根无效」—— 两种都不换身份，但对 owner 说的话不一样，
-- 而他下一步该做什么取决于这两个词的区别。
SELECT * FROM owners
WHERE pending_email_token_hash = $1 AND pending_email_token_hash <> '';
