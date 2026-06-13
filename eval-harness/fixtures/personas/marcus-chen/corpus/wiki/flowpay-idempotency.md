---
uri: wiki://work/flowpay/idempotency
title: Idempotency keys, and why I reach for them now
kind: wiki
tags: [work-experience, flowpay, payments, idempotency, api-design]
---

At FlowPay every write endpoint that moved money took an idempotency key. The
client generates a key per logical operation; if we see the same key twice we
return the original result instead of doing the work again. It's how you make "the
client retried because the response timed out" safe.

I implemented this for a couple of our payout endpoints. The mechanics are simple
— a table of (key, request hash, response) with a unique constraint — but the edge
cases are where it lives: what if the same key arrives with a *different* body
(reject it), what if two identical requests race (the unique constraint plus a
short lock), what's the TTL (we kept keys 24h).

It's invisible when it works and a disaster when it doesn't — a missing idempotency
key was the root cause of the double-charge incident (see
[[The double-charge incident (FlowPay)]]). I now add idempotency to any non-trivial
write API by default, even outside payments.
