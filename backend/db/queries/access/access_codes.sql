-- name: CreateAccessCode :one
-- A.3-IAM-5：每张码必挂 assumed_role_id。corpus_permissions / granted_skills
-- 等 legacy 字段在 commit 5 drop，ACL / capability gating 全部从 role 推断。
INSERT INTO access_codes (
    owner_id, code, label, purpose, ghosts,
    expires_at, max_turns_per_session,
    assumed_role_id, max_members, prompt_id, inline_prompt, provider_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: UpdateAccessCodeRole :one
-- Admin "reassign role"。新 role 必须属于同 owner（caller 校验过）。
UPDATE access_codes
SET assumed_role_id = $3
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: GetAccessCode :one
-- **不要在这里加 lower()**:`code` 列是 `citext`(见 schema.sql:245),比较本来就不分大小写。
-- 我曾以为「?code= 进不去是因为查码逐字比较」并改成 `lower(code)=lower($1)` —— 那是错的,
-- 而且有害:它让 citext 上那个 UNIQUE 索引用不上。**列的类型就是那条规矩**,别在查询里再写一遍。
SELECT * FROM access_codes WHERE code = $1 AND status = 'active';

-- name: GetAccessCodeAnyStatus :one
-- 不带状态过滤:让仓储分得出「这张码不存在」和「这张码被撤销了」。
-- 只按 status='active' 查的话两种都是 no-rows,访客那句拒绝就只能合成一句,
-- 而这两种人的下一步是相反的(重新粘一次 / 去要一张新的)—— F-D-6。
SELECT * FROM access_codes WHERE code = $1;

-- name: GetAccessCodeByID :one
SELECT * FROM access_codes WHERE id = $1;

-- name: ListAccessCodesByOwner :many
SELECT * FROM access_codes WHERE owner_id = $1 ORDER BY created_at DESC;

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
-- F-A-10 per-code 覆盖:NULL = 继承 role 的开关;true/false = 这张码显式覆盖。
UPDATE access_codes
SET require_ghost_evidence = $3
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: CountCodeMembers :one
-- max_members 强制用:这张码已经有几个不同名字(member)。
SELECT count(*) FROM code_members WHERE code_id = $1;

-- name: LockCodeForMemberInsert :one
-- 名额闸门的第一步:**单独一条语句**锁住这张码,并读回 max_members。
--
-- 为什么必须单独一条:READ COMMITTED 下,一条语句里的所有读取共用**语句开始时**的那个快照。
-- 把 `FOR UPDATE` 和 `count(*)` 写进同一条语句(CTE)时,第二个并发请求确实会阻塞在锁上,
-- 但拿到锁之后它的 count 仍然来自旧快照 —— 看不见对方刚提交的那一行,于是照样放行。
-- 锁串行了,计数没有(F-D-5 的第一版就是这样,它的注释还写着「没有缝」)。
-- 拆成两条之后,count 是锁**之后**才开始的新语句,新快照,看得见已提交的成员。
SELECT max_members FROM access_codes WHERE id = $1 FOR UPDATE;

-- name: GetCodeMemberByID :one
-- 按 member id 取(client 存了 member_id,再来时凭 id 续会;尤其匿名者)。
-- 限定 code_id 防跨码串。
SELECT * FROM code_members WHERE id = $1 AND code_id = $2;

-- name: CreateCodeMember :one
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: MemberExistsByName :one
-- 同名 = 续会,不吃新名额。跟 count 一样必须在锁之后单独读。
SELECT EXISTS (SELECT 1 FROM code_members WHERE code_id = $1 AND display_name = $2);

-- name: UpsertCodeMember :one
-- 真正落库那一步。名额是否够由调用方在同一个事务里、拿到行锁之后判定 ——
-- 所以这里不再自己带闸门（带了也没用，见 LockCodeForMemberInsert 的注释）。
INSERT INTO code_members (code_id, display_name, email, is_anonymous)
VALUES ($1, $2, $3, $4)
ON CONFLICT (code_id, display_name) DO UPDATE SET last_seen_at = now()
RETURNING *;

-- GetOrCreateCodeMember —— 建/续一个成员，**名额上限在同一条语句里守住**。
--
-- ⚠️ 这条**已经不是名额闸门**（它守不住，见 LockCodeForMemberInsert）。留着是因为还有
-- 不带上限的调用路径；带上限的那条走 repo 里的事务版本。
--
-- 上限以前只在 usecase 里比一个早先读出来的列表，插入是裸 INSERT：两个会话同时进来都读到
-- len=9、都判 9 < 10、都插进去，于是一张上限 10 的码能长到 11 个人，然后卡死在「满了而且多一个」
-- （F-D-5，实测 12 并发打进上限 5 的码 → 落库 6）。顺序跑的用例永远看不见这件事。
--
-- `FOR UPDATE` 锁的是 access_codes 那一行：并发的第二条语句会阻塞到第一条提交，再重读计数，
-- 所以计数和插入之间没有缝。同名放行是**续会**，不吃新名额。
-- 满了 → 一行都不插 → :one 返回 no-rows，调用方据此报「已满」。行数就是回执。
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
-- 逐条 insert(数量少 + evidence_refs 是 per-row jsonb),同 AttachRoleWaypoint。
INSERT INTO code_waypoints (code_id, waypoint_id, description, weight, evidence_refs, is_terminal)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (code_id, waypoint_id) DO NOTHING;

-- name: ListCodeWaypoints :many
-- 这张 code 的 waypoint **覆盖层**(不含继承来的 role 的);合并在 domain.MergeWaypoints。
SELECT waypoint_id, description, weight, evidence_refs, is_terminal
FROM code_waypoints WHERE code_id = $1 ORDER BY weight DESC, waypoint_id ASC;

-- name: ClearCodeCorpusDenials :exec
DELETE FROM code_corpus_denials WHERE code_id = $1;

-- name: AttachCodeCorpusDenial :exec
INSERT INTO code_corpus_denials (code_id, uri_pattern)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: ListCodeCorpusDenials :many
-- 这张 code 收回的 URI glob（纯减法层；role 的正列表减去它 = 本码实际可读）。
SELECT uri_pattern FROM code_corpus_denials WHERE code_id = $1 ORDER BY uri_pattern ASC;
