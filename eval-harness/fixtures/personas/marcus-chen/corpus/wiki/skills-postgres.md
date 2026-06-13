---
uri: wiki://profile/skills/postgres
title: Postgres, what I actually use
kind: wiki
tags: [skills, postgres, databases]
---

Postgres is the database I've used most and the one I'm most comfortable with. I
can design a normalized-enough schema, write non-trivial SQL without reaching for
an ORM crutch, read an EXPLAIN ANALYZE and act on it, and pick indexes that
actually help.

Things I've done in real work: fixed slow queries by understanding the plan (see
wiki://project/slow-query-optimization), used transactions and the right isolation
level to avoid race conditions, added partial and composite indexes, and used
SKIP LOCKED for a simple job queue.

Where I stop: I'm not a DBA. I understand vacuum and bloat enough to not be
dangerous, but I've never tuned a big instance's memory settings or run
replication failover for real — that's always been someone else's job. Sharding I
know only in theory.

If a query's slow or a schema decision needs making, I'm a safe pair of hands. If
the database itself is on fire, I'm calling someone.
