-- 2026-08-31 · 改邮箱要先证明新地址收得到信，才允许它成为登录身份。
--
-- schema.sql 只在**全新的 pg 卷**上跑一次，所以已经在跑的实例走这里的 ALTER
-- （[[schema-lives-in-the-volume-not-the-image]]）。可重入、非破坏性。
-- 写下来就会被跑：后端启动时自己打（`pgstore.Migrate`，编在同一个二进制里），
-- 所以「部署这一版」＝「这一版的 schema 改动打过了」。不需要有人记得手工跑。
-- 存疑时 `make schema-drift` / `STACK=dev make schema-drift` 自证。
--
-- **为什么要这几列**：`owners.email` 这一列同时是**登录身份**和**恢复渠道**
-- （`usecase/recovery.go` 的 `To:` 直接读它）。原来改邮箱把两者原子地一起搬走，而搬走之前
-- 没有任何一步证明新地址收得到信。一个拼写错误同时拿掉钥匙和备用钥匙 —— 而 session 按
-- ownerID 发，当场毫无感觉，它在 session 过期那天才生效。
--
-- 所以身份不再当场搬走：新地址先进 pending，寄一封确认信，点开了才换。**pending 期间
-- 恢复短语仍然寄旧地址** —— 新地址还没被证明，把救命通道交给它就是把洞挪了个位置。
--
-- **只存 hash**，跟 `recovery_hash` / `setup_token_hash` 一个姿势：明文只进那封邮件。
-- 一次性靠确认时清空这三列实现 —— 可重放的确认链接等于把身份挂在一封旧邮件上。
--
-- **为什么是 owners 上的列而不是一张表**：一个 owner 至多有一次待确认的改动，这是关于
-- 这个 owner 的一个事实。跟 2026-08-23 那次码绑页一样的理由：一个事实一处存。
--
-- pending_email 用 citext：它将来要成为 owners.email，两边得用同一把尺子比较。
-- 但**不加 UNIQUE** —— v1 单 owner；而且待确认的地址还不是身份，不该占用命名空间。

ALTER TABLE owners ADD COLUMN IF NOT EXISTS pending_email citext;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS pending_email_token_hash text NOT NULL DEFAULT '';
ALTER TABLE owners ADD COLUMN IF NOT EXISTS pending_email_expires_at timestamptz;
