-- +goose Up

-- access_codes —— owner 发给访客的访问码（LABEL-XXX 格式，一码多人共用）。
CREATE TABLE access_codes (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code                citext        UNIQUE NOT NULL,
    label               text          NOT NULL,
    purpose             text          NOT NULL DEFAULT '',
    included_tags       text[]        NOT NULL DEFAULT '{}',
    excluded_tags       text[]        NOT NULL DEFAULT '{}',
    suggested_questions jsonb         NOT NULL DEFAULT '[]'::jsonb,
    expires_at          timestamptz,
    status              text          NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active', 'revoked', 'expired')),
    created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX access_codes_owner_idx ON access_codes(owner_id, status);

-- code_members —— 预声明的 reviewers（"Alice (HR)"、"Bob (Eng)"）+ 匿名访客落地后写入。
CREATE TABLE code_members (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id       uuid          NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    display_name  text          NOT NULL,
    email         citext,
    is_anonymous  boolean       NOT NULL DEFAULT false,
    last_seen_at  timestamptz
);

CREATE INDEX code_members_code_idx ON code_members(code_id);

-- conversations —— visitor 的一次 chat session（一个 code 可有多 conversation）。
CREATE TABLE conversations (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    tier            text          NOT NULL CHECK (tier IN ('code', 'byoai')),
    code_id         uuid          REFERENCES access_codes(id) ON DELETE SET NULL,
    member_id       uuid          REFERENCES code_members(id) ON DELETE SET NULL,
    visitor_name    text          NOT NULL DEFAULT '',
    byoai_provider  text,
    started_at      timestamptz   NOT NULL DEFAULT now(),
    last_at         timestamptz   NOT NULL DEFAULT now(),
    message_count   integer       NOT NULL DEFAULT 0,
    hit_private     boolean       NOT NULL DEFAULT false
);

CREATE INDEX conversations_owner_started_idx ON conversations(owner_id, started_at DESC);

-- messages —— visitor / assistant 消息流水。
CREATE TABLE messages (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             text          NOT NULL CHECK (role IN ('visitor', 'assistant')),
    body             text          NOT NULL,
    tool_calls       jsonb,
    cited_wiki_ids   uuid[]        NOT NULL DEFAULT '{}',
    created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX messages_conv_created_idx ON messages(conversation_id, created_at);

-- +goose Down
DROP TABLE messages;
DROP TABLE conversations;
DROP TABLE code_members;
DROP TABLE access_codes;
