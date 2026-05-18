-- +goose Up

-- custom_pages —— owner 自定义页面。一个 page 对应一个 slug，挂载到
-- /<handle>/p/<slug>/*。 live_build_id 指向当前对访客可见的 build；
-- staging_build_id 指向 owner 自测的 build。删 page = status='deleted'，软
-- 删保留 build artifact 给 audit。
CREATE TABLE custom_pages (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    slug                citext        NOT NULL,
    title               text          NOT NULL DEFAULT '',
    status              text          NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active', 'archived', 'deleted')),
    live_build_id       uuid,
    staging_build_id    uuid,
    previous_live_build_id uuid,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX custom_pages_owner_slug_idx ON custom_pages(owner_id, slug);

-- custom_page_builds —— 每次 sandbox build 一行；source_files 是 owner 写的
-- 源码（map path → text）；output_path 是 build 完后产物的相对路径，
-- backend 进程能 ReadFile。
CREATE TABLE custom_page_builds (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         uuid          NOT NULL REFERENCES custom_pages(id) ON DELETE CASCADE,
    status          text          NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'building', 'built', 'failed')),
    source_files    jsonb         NOT NULL DEFAULT '{}'::jsonb,
    output_path     text          NOT NULL DEFAULT '',
    error_message   text          NOT NULL DEFAULT '',
    created_at      timestamptz   NOT NULL DEFAULT now(),
    built_at        timestamptz
);

CREATE INDEX custom_page_builds_page_idx ON custom_page_builds(page_id, created_at DESC);

-- live_build_id / staging_build_id / previous_live_build_id 这些 FK 在 page
-- 表 INSERT 时还指向尚未存在的 build；用 deferred FK 让事务结束时再校验。
ALTER TABLE custom_pages
    ADD CONSTRAINT custom_pages_live_build_fk
        FOREIGN KEY (live_build_id) REFERENCES custom_page_builds(id) ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT custom_pages_staging_build_fk
        FOREIGN KEY (staging_build_id) REFERENCES custom_page_builds(id) ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT custom_pages_prev_build_fk
        FOREIGN KEY (previous_live_build_id) REFERENCES custom_page_builds(id) ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED;

-- +goose Down
ALTER TABLE custom_pages DROP CONSTRAINT IF EXISTS custom_pages_prev_build_fk;
ALTER TABLE custom_pages DROP CONSTRAINT IF EXISTS custom_pages_staging_build_fk;
ALTER TABLE custom_pages DROP CONSTRAINT IF EXISTS custom_pages_live_build_fk;
DROP TABLE IF EXISTS custom_page_builds;
DROP TABLE IF EXISTS custom_pages;
