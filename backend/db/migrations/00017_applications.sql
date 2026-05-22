-- +goose Up

-- Phase 3: applications —— owner 确认投递的求职申请。draft 在 commit 时
-- 同时 (a) issue 一个 AccessCode (180d / 10 sessions / 50 turns) (b) 写
-- application 行 (c) 删 draft (d) 渲染最终 PDF（QR 指 /<handle>?code=ABC）。
--
-- access_code_id 指向同步 issue 的 access code。两条记录的关系是 1:1：
-- application 在的时候 code 必须在；application 删了 code 可以保留（recruiter
-- 还能用 code 来 visitor chat）。删 application 不级联删 code。
--
-- job_snapshot + resume_content 都是 jsonb 持久化快照（不依赖 draft 已删的事实
-- 也不依赖 Redis 池子还在）。submitted_at 给未来 Phase 4 Playwright 提交后回写。
CREATE TABLE applications (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    access_code_id uuid          NOT NULL REFERENCES access_codes(id) ON DELETE RESTRICT,
    job_snapshot   jsonb         NOT NULL,
    resume_content jsonb         NOT NULL,
    status         text          NOT NULL DEFAULT 'pending',
    submitted_at   timestamptz,
    created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX applications_owner_idx ON applications(owner_id);
CREATE INDEX applications_access_code_idx ON applications(access_code_id);

-- +goose Down
DROP TABLE IF EXISTS applications;
