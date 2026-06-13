---
uri: wiki://knowledge/retries-backoff
title: Retries, backoff, and dead-letter queues
kind: wiki
tags: [knowledge, reliability, retries]
---

When something downstream fails, you retry — but naive retries make outages worse:
everyone retries at once and hammers the recovering service. The pattern I use:

- **Exponential backoff** — wait 1s, 2s, 4s… so you back off as failures persist.
- **Jitter** — randomize the wait so a thousand clients don't retry in lockstep.
  This one isn't optional at scale; I learned that the boring way.
- **A retry cap** — give up after N attempts instead of retrying forever.
- **A dead-letter queue** — park permanent failures somewhere so they're not lost
  and can be inspected or replayed.

I built this for webhook delivery at FlowPay (see [[Webhook delivery and retries (FlowPay)]]) and
again in the notification pipeline. The part I consistently underrate is the DLQ
operational story — parking failures is easy, actually monitoring and replaying
them is the work, and it's the bit I left half-done (see
[[Dead-letter handling (the part I keep meaning to fix)]]). Retries also assume the
operation is safe to repeat (see [[Idempotency, as a pattern]]).
