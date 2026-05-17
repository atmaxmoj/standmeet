-- +goose Up
CREATE TABLE api_tokens (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name          text          NOT NULL,                       -- "mojat-mbp" 之类设备名
    token_hash    text          UNIQUE NOT NULL,                -- sha256(plaintext)
    scopes        text[]        NOT NULL DEFAULT ARRAY['*'],    -- v1 全权限占位；schema 预留粗粒度
    last_used_at  timestamptz,
    created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX api_tokens_owner_idx ON api_tokens(owner_id);

-- +goose Down
DROP TABLE api_tokens;
