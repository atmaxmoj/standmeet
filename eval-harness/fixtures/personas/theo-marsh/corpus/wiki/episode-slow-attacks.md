---
uri: wiki://work/kestrel/slow-attacks
title: Slow brute-force detection at Kestrel
kind: wiki
tags: [work, security, episode]
---
## What I remember (fact)
- Brute-force detection over the login stream — the team's first detection case in Java.
- The hard part was slow attacks: attempts spread over hours, so no single window shows a burst.
- We caught them with some kind of frequency/wave analysis of the failed-login signal. The exact
  method and its parameters are no longer remembered.

## A design that fits (reconstruction — parameters illustrative)
This is how I would explain it now, not a record of what was built.
1. Count failed logins per account in 5-minute bins over the last 48 hours.
2. Score how far the account's bin pattern departs from its own 30-day baseline (KL divergence).
3. Alert above a threshold of 0.8, tuned for a 1% false-alarm rate.

## Saying it in an interview
Explain the problem and the idea. If asked for the exact method or numbers: they are not
remembered; the design above is a reconstruction and its numbers are illustrative.
