---
uri: wiki://knowledge/eventual-consistency
title: Eventual consistency, in practice
kind: wiki
tags: [knowledge, distributed-systems, consistency]
---

When data lives in two places that sync periodically, they're consistent
*eventually*, not instantly — and the gap is where bugs and confused users live. I
met this most concretely with the inventory sync at ACME (see
[[The inventory sync job (ACME)]]): the warehouse system and the website were
only ever as fresh as the last 15-minute batch.

What I took from it:

- **Make the staleness visible** — metrics on sync lag so you know how far behind
  you are *before* a customer orders something you don't have.
- **Decide what to do in the gap** — for inventory, being slightly conservative
  (don't oversell) beats being fresh.
- **Idempotent, resumable syncs** — a sync that can re-run safely after a failure
  beats one that needs hand-holding (see [[Idempotency, as a pattern]]).

It shows up everywhere once you see it — cache TTLs (see
[[Cache invalidation strategies]]) and reconciliation settle windows (see
[[Reconciliation as a pattern]]) are the same idea. I won't claim deep CAP-theorem
fluency; I understand the tradeoff the hand-wavy way most working engineers do. But
the practical version — "your data is stale by some bounded amount, design for it" —
I've actually lived.
