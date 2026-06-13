---
uri: wiki://project/notification-pipeline/rollout
title: Rolling it out without spamming anyone
kind: wiki
tags: [orbit, notifications, deployment, rollout]
---

The scary part of replacing a notification system is that the failure mode is
*visible to customers* — either silence (they miss something) or a flood (you spam
them). You don't get to quietly roll back a thousand emails you already sent.

So I rolled it out behind a flag (see wiki://work/orbit/feature-flags), and I ran
the new pipeline in shadow mode first: it did all the work — fan-out, rate-limit,
dedup — but instead of actually sending, it logged what it *would* have sent. I
diffed that against what the old system actually sent for a couple of weeks, until
the only differences were ones I could explain (mostly the new dedup correctly
suppressing things the old one double-sent).

Then I turned real sending on for internal accounts, then a few friendly customers,
then ramped. The shadow-mode diff is the thing I'd do again on anything with a
customer-visible side effect — it turned "I think this is right" into "I have two
weeks of evidence this is right."
