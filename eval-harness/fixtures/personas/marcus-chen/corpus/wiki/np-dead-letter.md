---
uri: wiki://project/notification-pipeline/dead-letter
title: Dead-letter handling (the part I keep meaning to fix)
kind: wiki
tags: [orbit, notifications, reliability, tech-debt]
---

When a notification fails all its retries — a webhook endpoint that's been down for
an hour, an email the provider keeps rejecting — it goes to a dead-letter stream so
it's not lost. That's the good part. The rest I'm less proud of.

Nobody monitors the dead-letter stream well. There's a metric and a dashboard
panel, but no alert that fires when it grows, so a "customer silently stopped
getting notifications" failure can sit unnoticed until they ask. Replaying is a
manual script I wrote that I run by hand, and it doesn't have great guardrails
against replaying something twice.

I know what good looks like here — an alert on dead-letter growth, a proper replay
tool with idempotency (see [[Idempotency keys, and why I reach for them now]]), maybe a per-customer
"you have undelivered notifications" surface. I've written the ticket twice and it
keeps losing to feature work. I'm including it because the honest version of a
project includes the part you haven't gotten to, and this is mine.
