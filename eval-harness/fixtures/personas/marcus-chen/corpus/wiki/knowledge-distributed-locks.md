---
uri: wiki://knowledge/distributed-locks
title: Distributed locks and atomic operations
kind: wiki
tags: [knowledge, concurrency, redis]
---

When work is spread across a pool of processes, "just use a mutex" doesn't work —
the lock has to live somewhere shared. The options I've used or weighed:

- **An atomic operation instead of a lock** — often the best answer. If you can
  express the whole critical section as one atomic step, you don't need a lock at
  all. A Redis Lua script runs atomically; that's how I made the rate-limiter's
  check-and-decrement safe (see
  wiki://project/notification-pipeline/rate-limiting/lua-script).
- **A database row lock** (`SELECT … FOR UPDATE`) — correct and durable, scoped to a
  transaction. My default when the state is already in Postgres (see
  wiki://knowledge/isolation-levels).
- **A Redis lock (SET NX with TTL)** — simple, but the TTL/renewal and failure modes
  are genuinely tricky; I'm wary of rolling my own and treat it as the option I'd
  reach for last.

My honest take: most of the time the right move is to avoid the lock by finding the
atomic operation, not to build a better lock. The cases where you truly need a
distributed lock are rarer than they first look.
