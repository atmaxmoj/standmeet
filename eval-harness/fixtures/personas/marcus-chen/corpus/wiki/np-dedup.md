---
uri: wiki://project/notification-pipeline/dedup
title: Dedup — the same event twice
kind: wiki
tags: [orbit, notifications, dedup, redis]
---

Upstream systems sometimes emit the same logical event twice — a retry, a duplicate
webhook, two services both noticing the same failure. Without dedup a customer gets
"your sync failed" twice in five minutes and stops trusting us.

The mechanism is simple: each event carries (or we derive) a dedup key, and before
processing we SET the key in Redis with NX (only-if-absent) and a short TTL. If the
SET fails, we've seen it recently and we drop it. The TTL is the dedup window — we
used five minutes, long enough to catch retries, short enough that a genuinely
recurring problem still re-notifies.

The hard part wasn't the Redis bit, it was choosing the key. Too specific (include a
timestamp) and nothing ever dedups; too broad and you suppress distinct events that
happen to look alike. I settled on hashing the (customer, event-type, subject)
tuple and explicitly *not* the timestamp. Getting that key right took a couple of
iterations and a confused support ticket.
