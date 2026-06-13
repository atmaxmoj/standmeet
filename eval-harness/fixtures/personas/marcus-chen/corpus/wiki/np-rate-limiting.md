---
uri: wiki://project/notification-pipeline/rate-limiting
title: Rate limiting — token buckets in Redis
kind: wiki
tags: [orbit, notifications, rate-limiting, redis]
---

Each (customer, channel) pair gets a token bucket: a steady refill rate and a
burst capacity, so a customer can get a quick burst of notifications but not an
unbounded flood. Buckets live in Redis because the workers are a pool and the limit
has to be shared across all of them.

The naive version — GET the count, check it, SET it back — has an obvious race: two
workers read the same value and both decide they're under the limit. With a pool of
workers that race fires constantly. The fix is making the check-and-decrement
atomic, which is where the Lua script comes in (see
[[The atomic check-and-decrement, line by line]]).

Tuning the numbers was its own thing. Too tight and legitimate bursts get throttled
and customers complain they "missed" a notification; too loose and the limiter
isn't doing anything. We landed on per-channel defaults with per-customer overrides
for the few big accounts. It's the part of the system I understand best, because I
had to.
