---
uri: wiki://project/slow-query-optimization
title: The Checkout Slowdown — a performance investigation (ACME)
kind: wiki
tags: [project, performance, mysql, indexing, debugging, deep-dive]
---

A smaller but instructive one. At ACME Retail, checkout latency crept up over a
few months until the p99 was over four seconds and customer service was getting
complaints about the page hanging. I owned the investigation.

It turned out not to be one thing. The story, in order of what I found:
1. The order-summary endpoint ran a query that joined orders, line_items,
   promotions, and inventory. As the promotions table grew, the optimizer
   started choosing a bad join order and doing a full scan on line_items. A
   composite index on (order_id, promotion_id) fixed the worst of it and cut p99
   roughly in half.
2. But it was still slow under load. We were making the same inventory lookup
   several times per checkout because three different code paths each fetched it
   independently. I added a request-scoped cache so we fetched once. That helped
   p50 more than p99.
3. The remaining tail was lock contention: two transactions both touching the
   inventory row for a hot SKU during a flash sale. I narrowed the transaction
   scope so we held the row lock for milliseconds instead of the whole checkout.

End result: p99 from ~4s back down to ~600ms. It took about three weeks,
mostly spent reading slow query logs and adding metrics, not writing code.

Why I like telling this story: it's the project that taught me performance work
is investigation, not cleverness. I didn't do anything brilliant — I measured,
found three boring problems, and fixed each one. The skill was in the
measurement and in not stopping after the first fix made the graph look better.

Where I'm honest: I understand single-database performance well. I have much less
experience with performance at the scale where you're sharding, or where the
bottleneck is network and serialization rather than the database. I've read
about it; I haven't lived it.
