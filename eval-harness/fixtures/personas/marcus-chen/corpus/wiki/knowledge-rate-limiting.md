---
uri: wiki://knowledge/rate-limiting
title: Rate limiting — token bucket vs leaky bucket
kind: wiki
tags: [knowledge, rate-limiting, redis]
---

Rate limiting is about smoothing or capping a flow. The two shapes I actually
understand:

**Token bucket** — a bucket refills at a steady rate up to a burst capacity, and
each request spends a token. It allows short bursts but caps the sustained rate.
This is what I used for per-(customer, channel) limits in the notification pipeline
(see wiki://project/notification-pipeline/rate-limiting). It's my default because
the burst behavior matches what real traffic looks like.

**Leaky bucket** — requests drain at a fixed rate regardless of bursts; smoother
output, no burst allowance. I've read about it more than used it.

The implementation gotcha that bit me: doing the check-and-decrement atomically
across a worker pool. A plain read-modify-write races; I solved it with a Redis Lua
script (see wiki://project/notification-pipeline/rate-limiting/lua-script). The
algorithm is the easy part — making it correct under concurrency
(see wiki://knowledge/distributed-locks) is the real work.
