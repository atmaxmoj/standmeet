-- 2026-10-11-visit-event-network.sql — where on the internet a visitor sat, at organisation grain
-- (owner, 2026-10-11: 1581 views from Singapore and no way to tell a data centre from a person).
-- Reentrant. network: the /24 (IPv4) or /48 (IPv6) the address sits in; asn / as_org: the
-- autonomous system announcing it (db-ip ASN Lite). The address itself is still never stored.
-- Rows recorded before this read as no network.
ALTER TABLE visit_event ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT '';
ALTER TABLE visit_event ADD COLUMN IF NOT EXISTS asn bigint NOT NULL DEFAULT 0;
ALTER TABLE visit_event ADD COLUMN IF NOT EXISTS as_org text NOT NULL DEFAULT '';
