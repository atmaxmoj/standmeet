---
uri: wiki://thinking/boring-tech
title: Reaching for boring technology
kind: wiki
tags: [thinking, philosophy, pragmatism]
---

My default is the boring, well-understood tool: Postgres before the trendy
datastore, a background job before a streaming framework, a monolith-ish service
before a constellation of microservices. Not because new things are bad, but
because boring things have known failure modes and a big crowd who've already hit
them.

At FlowPay I watched us slide into the "maybe we have too many services now"
situation, and most of the pain was operational — distributed transactions,
tracing across services, deploy coordination — that a couple of well-factored
services would have avoided.

I'll reach for the exciting option when the boring one genuinely can't do the job,
and I try to be honest about when that's actually true versus when I just want to
play with something new. It isn't true as often as I'd like.
