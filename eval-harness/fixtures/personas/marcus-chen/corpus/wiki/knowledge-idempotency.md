---
uri: wiki://knowledge/idempotency
title: Idempotency, as a pattern
kind: wiki
tags: [knowledge, idempotency, api-design]
---

An operation is idempotent if doing it twice has the same effect as doing it once.
On any system where a client might retry — which is all of them — this is how you
stay correct when "did that request actually go through?" is unanswerable.

The usual implementation: the client sends an idempotency key per logical
operation; the server records (key → result) and, on a repeat key, returns the
stored result instead of re-doing the work. I built this for payout endpoints at
FlowPay (see [[Idempotency keys, and why I reach for them now]]). The edge cases are the real content
— same key with a different body (reject), two identical requests racing (unique
constraint + lock), and key TTL.

I care about this one because the absence of it caused the double-charge incident
(see [[The double-charge incident (FlowPay)]]). It's also half of how you fake
exactly-once delivery (see [[At-least-once, at-most-once, exactly-once]]). I now treat "is
this retry-safe?" as a default question for any write endpoint, not just payments.
