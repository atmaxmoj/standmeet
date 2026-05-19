-- +goose Up

-- access_requests —— visitor 在 /<handle>/gate 上的"write a note ↘"提交
-- 落到这里。owner 在 admin 里看，决定要不要回 + 发 code。
CREATE TABLE access_requests (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name        text          NOT NULL,
    org         text          NOT NULL DEFAULT '',
    email       citext        NOT NULL,
    message     text          NOT NULL,
    status      text          NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'replied', 'closed')),
    created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX access_requests_owner_idx ON access_requests(owner_id, created_at DESC);

-- +goose Down
DROP TABLE access_requests;
