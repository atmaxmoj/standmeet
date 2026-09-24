-- provider gas auto-refill schedule — a cron (standard 5-field or @daily/@hourly/@weekly, evaluated
-- in UTC) that re-opens a metered provider's gas tank on schedule, so a free tier can express
-- "resets daily". Empty = manual pool (today's behaviour). Additive + idempotent: upgrading a live
-- instance just adds the column; every existing provider defaults to '' (manual), so nothing changes
-- until an owner sets a schedule.
ALTER TABLE owner_providers ADD COLUMN IF NOT EXISTS gas_refill_cron text NOT NULL DEFAULT '';
