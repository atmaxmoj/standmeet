---
uri: wiki://knowledge/isolation-levels
title: Database isolation levels, where they bite
kind: wiki
tags: [knowledge, postgres, databases, concurrency]
---

Isolation levels control what concurrent transactions can see of each other. I
don't have them all memorized perfectly, but I understand the failures they prevent
and which ones I've actually hit:

- **Read Committed** (Postgres default) — you don't see uncommitted data, but two
  reads in one transaction can differ. Fine for most CRUD.
- **Repeatable Read** — a transaction sees a consistent snapshot; Postgres's version
  also catches a lot of write skew.
- **Serializable** — behaves as if transactions ran one at a time; safest, with a
  performance and retry cost.

Where this got real: read-then-write logic (check a balance, then update it) under
concurrency. The naive version has a race that Read Committed won't save you from —
you either bump the isolation level and handle serialization-failure retries, or you
use explicit locking (`SELECT … FOR UPDATE`, see wiki://knowledge/distributed-locks).
I reached for these during reconciliation work (see
wiki://project/order-reconciliation), and it's the Postgres knowledge (see
wiki://profile/skills/postgres) I'm proudest of actually understanding rather than
cargo-culting.
