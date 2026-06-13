---
uri: wiki://project/notification-pipeline/fan-out
title: Fan-out and per-event caps
kind: wiki
tags: [orbit, notifications, fan-out, design]
---

One event can become a lot of notifications. A team of 30 people all watching the
same integration means one "integration failing" event becomes 30 emails plus
however many Slack and webhook subscriptions. Fan-out is where a notification
system either stays calm or falls over.

What I did: expand each event into per-recipient, per-channel notifications in the
worker, but cap the fan-out per event so one pathological event — a misconfigured
integration firing in a loop — can't generate tens of thousands of notifications
and starve everyone else. Past the cap we collapse to a single "this is happening a
lot" summary and log it.

I batch where the channel allows it — email and Slack take batches, webhooks
mostly don't. The cap was the important part; it's a blast-radius limit. We added
it after an early incident where a customer's bad config turned one webhook loop
into a few thousand emails (see wiki://project/notification-pipeline). Caps are
boring, and they're the thing that lets me sleep.
