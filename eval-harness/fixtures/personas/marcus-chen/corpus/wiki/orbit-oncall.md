---
uri: wiki://work/orbit/oncall
title: On-call and the runbook (Orbit)
kind: wiki
tags: [work-experience, orbit, oncall, operations]
---

I'm in the on-call rotation for the notifications and integrations services — a
week roughly every six. It was intimidating at first; the first time I got paged
at 2am for a backed-up queue I had no real idea what I was doing and escalated
almost immediately.

What made it manageable was the runbook. Each alert links to a doc: here's what
this means, here's the dashboard, here are the three things to check first. I've
spent a fair amount of time improving those for the alerts I understand, because
the half-asleep version of me is much dumber than the version writing the doc.

Most pages are boring — a downstream provider is slow, the dead-letter queue is
filling, a deploy needs rolling back. Maybe one in ten is genuinely novel. I'm
comfortable handling the common cases now and knowing when to escalate the rest,
which is honestly most of what on-call is.
