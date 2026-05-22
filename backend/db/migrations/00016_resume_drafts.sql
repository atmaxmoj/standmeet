-- +goose Up

-- Phase 2: resume draft 中间态。Claude 通过 MCP `resume.draft` 写一行；
-- owner 看 preview（PDF bytes 现场渲染回 MCP 响应，不落盘）决定 commit
-- (Phase 3) 或 discard。job_snapshot 在 draft 创建时就从 Redis 池子复制
-- 进来，让 commit 不依赖 Redis TTL（L.13 决策）。
--
-- 关键设计：PDF 永远 ephemeral —— server 不存任何文件，每次 MCP 调用现场
-- 用 gopdf 重新渲染 bytes 塞响应。表里只存结构化数据。
CREATE TABLE resume_drafts (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    job_cache_id     text          NOT NULL,
    job_snapshot     jsonb         NOT NULL,
    resume_content   jsonb         NOT NULL,
    expires_at       timestamptz   NOT NULL DEFAULT now() + interval '1 day',
    created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX resume_drafts_owner_idx ON resume_drafts(owner_id);
CREATE INDEX resume_drafts_expires_idx ON resume_drafts(expires_at);

-- +goose Down
DROP TABLE IF EXISTS resume_drafts;
