---
uri: wiki://work/orbit/feature-flags
title: Shipping behind feature flags (Orbit)
kind: wiki
tags: [work-experience, orbit, deployment, feature-flags]
---

Orbit ships everything behind flags (we use LaunchDarkly). I didn't build the
system but I use it daily, and it changed how I think about shipping.

The habit: merge small, ship dark, turn on for internal users, then 1%, then ramp.
For the notification rate-limiter rewrite I had the new and old code paths both
live behind a flag, defaulting to old, and moved customers over in batches while
watching error rates. When one batch showed a spike in dropped webhooks I flipped
the flag back in seconds instead of doing an emergency revert-and-deploy.

The thing nobody tells you: flags are debt. We had flags that had been "temporary"
for a year, and a couple of incidents traced back to a stale flag in a weird
state. I try to delete mine within a sprint of fully rolling out — and I lose that
argument with myself about half the time.
