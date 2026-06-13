---
uri: wiki://profile/skills/debugging
title: How I actually debug production
kind: wiki
tags: [skills, debugging, operations]
---

This is the skill I'd most want to be judged on, because it's where the on-call
hours went.

My process is unglamorous: localize or reproduce first, read the logs and metrics
before forming a theory, and change one thing at a time. The mistake I used to
make — and still catch myself making — is jumping to a fix based on a guess. A
clear repro or a failing test first, fix second, every time.

I'm comfortable reading dashboards (Grafana, Datadog), grepping structured logs,
adding temporary logging when the existing logs aren't enough, and bisecting a bad
deploy. I've traced a few genuinely confusing bugs — a stale cache, a non-idempotent
retry, a lock-contention stall — back to root cause and written the postmortem.

What I'm not: a kernel- or network-trace-level debugger. When it gets below the
application layer I'm usually pairing with someone more senior.
