---
uri: wiki://knowledge/cache-invalidation
title: Cache invalidation strategies
kind: wiki
tags: [knowledge, caching, redis]
---

Caching is easy; knowing when the cached thing is stale is the whole problem. The
strategies I've actually used or weighed:

- **TTL (expiry)** — simplest, always correct *eventually*, wrong for up to the TTL.
  Fine when staleness is tolerable, a trap when it isn't.
- **Event-based invalidation** — bust the key when the underlying data changes.
  Correct and fast, but only if you know *every* way the data can change.
- **Write-through / write-behind** — update the cache as you write. More moving
  parts, fewer surprises.

I learned the hard way that the danger is data that changes through a path you
didn't account for — I cached a product but its price changed via a different
service, so my event-based invalidation missed it and the TTL was the only thing
saving me (see [[A caching bug that taught me invalidation (ACME)]]). Now my first question is
"every way this can change?", and I keep a sane TTL as a backstop even with event
invalidation. It's really a special case of eventual consistency (see
[[Eventual consistency, in practice]]).
