-- 2026-08-22 · F-C-56：上传来的连接器在列表里没有名字。
--
-- schema.sql 只在**全新的 pg 卷**上跑一次，所以已经在跑的实例要走这里的 ALTER
-- （[[schema-lives-in-the-volume-not-the-image]]）。可重入、非破坏性。
--
-- 卡名一直渲的是 `category`，而**没有绑品类契约的连接器 category 是空串** —— GitHub 那种
-- 落不到 calendar/mail 上的厂商只有「暴露成 agent 工具」这一条路，于是它在
-- `CONNECTORS YOU UPLOADED` 里就是一行没有名字的框；两条并排时 owner 分不出哪条是哪个厂商，
-- 也就不知道该给哪一条填凭据。
--
-- 名字不是新数据：产品在摄入那一刻就解析并显示过 `info.title`（`CONNECTOR CANDIDATE ·
-- GitHub v3 REST API`），只是没留下来。整份 spec 也一直存着，但那是 12.9 MB —— 每次列表
-- 都重解析一遍不是办法，所以写入时取一次。
--
-- 存量行留空串：它们的名字还是按老规矩从 category 来，不假装知道一个没记过的事实。

ALTER TABLE owner_connectors ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
