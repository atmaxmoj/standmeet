---
uri: wiki://project/notification-pipeline
title: Notification Pipeline (Orbit)
kind: wiki
tags: [project, golang, redis, rate-limiting, fan-out, deep-dive, saas]
---

At Orbit I built the notification pipeline that sends emails, Slack messages,
and webhooks when events happen in the product — "your sync finished", "an
integration is failing", that kind of thing. Before it, notifications were
fired inline from wherever the event happened, which meant a slow email provider
could stall a request, and there was no rate limiting, so a misconfigured
integration once spammed a customer with 4,000 emails in an hour.

The design: events go onto a Redis stream, a pool of Go workers consume them,
each event is expanded into per-channel notifications based on the user's
preferences, and each channel has its own rate limiter and retry policy. Email
goes through SendGrid, Slack through their API, webhooks straight to the
customer's endpoint with exponential backoff.

The parts I had to actually think about:
- **Fan-out.** One event can become many notifications (a team of 30 people all
  watching one integration). I batch where the channel allows it and cap fan-out
  per event so one noisy event can't drown the workers.
- **Rate limiting.** I used a token-bucket per (customer, channel) in Redis. The
  tricky bit was making it distributed-safe across workers; I used a small Lua
  script so the check-and-decrement is atomic.
- **Dedup.** The same logical event could be emitted twice upstream. I dedup on
  an event key with a short Redis TTL so a customer doesn't get the same "sync
  failed" twice in five minutes.

It's a solid system but I'll be honest that it's not novel — it's a fairly
standard queue-workers-with-rate-limiting design. I didn't invent anything here;
I applied patterns I'd read about and got the details right. The Lua script for
the atomic token bucket is the one piece I had to really work to understand.

What's still not great: the retry/dead-letter handling is clunky. Failed
webhooks go to a dead-letter stream but nobody really monitors it well, and
replaying them is a manual script. I keep meaning to fix it.
