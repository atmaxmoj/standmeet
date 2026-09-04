-- 2026-08-21 · bookings.code_id → subject_id/subject_kind (F-B-11).
--
-- What changed above this file: a capability's usage quota used to be declared per **code**
-- (`QuotaDecl{ConfigKey:"max_bookings", CodeField:"code_id"}`), and the outward API-key plane has
-- no code — so a key could book without any limit at all. The quota now hangs on the session's
-- **subject**, which is a code on the visitor path and the key itself on the API path.
--
-- Why this file exists: the counter reads `subject_id` out of the plugin's own documents. Every
-- booking already written carries `code_id`. Without this migration a long-lived instance keeps
-- those rows, the counter finds nothing under the new field, and **every existing code's usage
-- silently resets to zero** — a code that had used all three of its bookings would hand out three
-- more. A quota that quietly stops counting is worse than one that never existed, because the
-- owner has no way to notice.
--
-- Non-destructive: no row is deleted, nothing renders differently. The old key is removed only
-- after its value has been copied, and only on rows that actually carry it (`? 'code_id'`), so
-- running this twice is a no-op.
--
-- `subject_kind` is 'code' for every existing row by construction: the API-key path could not
-- write a booking before this change (it had no subject to write).

-- Guard: mcp_calendar_book.records is the booking capability's **own capstore** table, created by
-- that capability at runtime — it is NOT in schema.sql or any earlier migration. On a **fresh**
-- install this migration runs before the capability has ever created it, so an unguarded UPDATE
-- crash-loops the backend on first boot (F-B-11 follow-up: real-host upgrade e2e surfaced this —
-- masked until now by persistent dev volumes and incrementally-migrated prod). A fresh install has
-- no bookings to migrate anyway, so skip when the table isn't there yet. `to_regclass` returns
-- NULL for a missing relation, so this stays a no-op run-twice.
DO $$
BEGIN
  IF to_regclass('mcp_calendar_book.records') IS NOT NULL THEN
    UPDATE mcp_calendar_book.records
       SET doc = (doc - 'code_id')
                 || jsonb_build_object('subject_id', doc -> 'code_id', 'subject_kind', '"code"'::jsonb)
     WHERE collection = 'bookings'
       AND doc ? 'code_id';
  END IF;
END $$;
