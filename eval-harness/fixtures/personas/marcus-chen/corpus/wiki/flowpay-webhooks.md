---
uri: wiki://work/flowpay/webhooks
title: Webhook delivery and retries (FlowPay)
kind: wiki
tags: [work-experience, flowpay, webhooks, reliability]
---

FlowPay sent webhooks to merchants when a payout settled or failed. I owned a
chunk of the delivery system — not the whole thing, but the retry and dead-letter
handling.

Delivery is deceptively hard. Merchant endpoints are down, slow, return 200 but
didn't actually process it, or rate-limit you. We did exponential backoff with
jitter, capped retries, and parked permanent failures in a dead-letter table with
a small UI for support to replay. Signing each payload (HMAC) so merchants could
verify it was us mattered to them more than I expected.

The bug I remember: our retry re-rendered the payload from current state, so a
webhook that failed at 2pm and succeeded on retry at 2:05 could carry data that
had changed in between. We switched to storing the exact payload at first send and
replaying that byte-for-byte. Obvious in hindsight; it took a confused merchant
support ticket for me to see it.
