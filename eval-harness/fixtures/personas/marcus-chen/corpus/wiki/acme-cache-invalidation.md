---
uri: wiki://work/acme-retail/cache-invalidation
title: A caching bug that taught me invalidation (ACME)
kind: wiki
tags: [work-experience, acme, caching, redis, bug]
---

Early at ACME I added Redis caching to the product-detail endpoint because it was
hammering Postgres. It worked great and I was pleased with myself. Then merchants
started complaining that price changes took "random" amounts of time to show up.

The bug was the classic one: I cached the product but invalidated on the wrong
events. Price came from a different service and changed without touching the
product record I was keying on, so the cache happily served stale prices until the
TTL expired. The "random" delay was just the TTL.

The fix was unglamorous — subscribe to price-change events and bust the key
explicitly, plus a shorter TTL as a safety net. The lesson stuck though: the hard
part of caching isn't the cache, it's knowing every way the underlying data can
change. I treat "what invalidates this?" as the first question now, not the last.
