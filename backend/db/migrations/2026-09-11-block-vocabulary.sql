-- 2026-09-11-block-vocabulary.sql — the tables say what the design says.
--
-- `docs/design/plugin/architecture.md`: the kernel *"knows no capability and no domain"*, and
-- `block-model.md` fixes the words — a **block** is a directory and a manifest, one loaded
-- block is a **fiber**, and a **seam** is the name a consumer asks for without naming a
-- supplier. "connector" and "capability" were the two axes this design replaced; a schema that
-- still spells them keeps the dead model alive in the one place everything else reads from.
--
-- Five renames, all pure:
--
--   owner_connectors          → block_connections      (connector_id → block_id, category → seam)
--   capability_settings       → block_enabled          (capability_id → block_id)
--   code_capability_denials   → code_block_denials     (capability_id → block_id)
--   api_key_capability_denials→ api_key_block_denials  (capability_id → block_id)
--   api_open_capabilities     → api_open_blocks        (capability_id → block_id)
--
-- No data moves and no column changes type, so this is reversible by renaming back.
--
-- `IF EXISTS` / `IF NOT EXISTS` throughout: a fresh volume builds from schema.sql and already
-- has the new names, while an existing volume arrives with the old ones. The same file has to
-- be a no-op for the first and a rename for the second.

-- ── owner_connectors → block_connections ────────────────────────────────────

ALTER TABLE IF EXISTS owner_connectors RENAME TO block_connections;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'block_connections' AND column_name = 'connector_id'
    ) THEN
        ALTER TABLE block_connections RENAME COLUMN connector_id TO block_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'block_connections' AND column_name = 'category'
    ) THEN
        ALTER TABLE block_connections RENAME COLUMN category TO seam;
    END IF;
END $$;

ALTER INDEX IF EXISTS owner_connectors_owner_connector_uniq
    RENAME TO block_connections_owner_block_uniq;

-- ── capability_settings → block_enabled ─────────────────────────────────────

ALTER TABLE IF EXISTS capability_settings RENAME TO block_enabled;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'block_enabled' AND column_name = 'capability_id'
    ) THEN
        ALTER TABLE block_enabled RENAME COLUMN capability_id TO block_id;
    END IF;
END $$;

-- ── the three ACL tables that named the dead axis ───────────────────────────
--
-- Same shape as above, three times. The column is `capability_id` in all three, and it holds a
-- registry id (no FK), so nothing depends on the name but the queries.

ALTER TABLE IF EXISTS code_capability_denials RENAME TO code_block_denials;
ALTER TABLE IF EXISTS api_key_capability_denials RENAME TO api_key_block_denials;
ALTER TABLE IF EXISTS api_open_capabilities RENAME TO api_open_blocks;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['code_block_denials', 'api_key_block_denials', 'api_open_blocks']
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = t AND column_name = 'capability_id'
        ) THEN
            EXECUTE format('ALTER TABLE %I RENAME COLUMN capability_id TO block_id', t);
        END IF;
    END LOOP;
END $$;

-- ── the per-block document store's collection names ─────────────────────────
--
-- `blockconfig` writes its values as rows in each block's own `<schema>.records` table,
-- tagged by a `collection` name. Four of those names still spelled `capconfig`. They are
-- values, not identifiers, so this is an UPDATE — run across every block schema that
-- exists on this instance.
--
-- Leave the row alone if the new name is already present: a fresh volume writes the new
-- names from the start, and re-running must not double-rename.

DO $$
DECLARE
    s text;
BEGIN
    FOR s IN
        SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mcp\_%' OR nspname LIKE 'connector\_%'
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = s AND table_name = 'records'
        ) THEN
            EXECUTE format(
                'UPDATE %I.records SET collection = ''block'' || substring(collection from 4) '
                || 'WHERE collection LIKE ''capconfig%%''', s);
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = s AND table_name = 'claims'
        ) THEN
            EXECUTE format(
                'UPDATE %I.claims SET collection = ''block'' || substring(collection from 4) '
                || 'WHERE collection LIKE ''capconfig%%''', s);
        END IF;
    END LOOP;
END $$;
