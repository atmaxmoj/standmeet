-- +goose Up

-- owners 增加 AI provider 字段，让每个 owner 配自己的 inference key（不再
-- 走全实例统一的 INFERENCE_PROVIDER env）。
--
-- ai_provider:        'mock' / 'anthropic' / 'openai'。'mock' 默认保 dev 路径。
-- ai_provider_key_enc: AES-256-GCM 加密的原始 key 字节（nonce|ciphertext|tag
--                     拼一起）。明文不落盘。empty bytes 表示未配置。

ALTER TABLE owners
    ADD COLUMN ai_provider          text   NOT NULL DEFAULT 'mock'
                                            CHECK (ai_provider IN ('mock', 'anthropic', 'openai')),
    ADD COLUMN ai_provider_key_enc  bytea  NOT NULL DEFAULT ''::bytea;

-- +goose Down
ALTER TABLE owners
    DROP COLUMN IF EXISTS ai_provider_key_enc,
    DROP COLUMN IF EXISTS ai_provider;
