---
uri: wiki://work/flowpay
title: FlowPay — Backend Engineer (2021–2023)
kind: wiki
tags: [work-experience, fintech, golang, payments, kafka, postgres, startup]
---

FlowPay was a ~50-person fintech startup doing payment processing and payouts
for marketplaces. This is where I switched to Go and learned what "correctness
actually matters" feels like, because every bug was potentially money moving the
wrong way.

I was on the ledger and reconciliation team. My biggest piece of work was the
payment reconciliation pipeline (see wiki://project/order-reconciliation) — the
system that matched our internal ledger against what the payment processors
(Stripe, Adyen) said actually happened, and flagged the mismatches. Before it,
reconciliation was a finance person with a giant spreadsheet.

Tech stack: Go services, Postgres, Kafka for event streaming, Redis, all on AWS
(ECS, RDS). About 25 engineers by the time I left. We were past the
"everything in one repo" stage and into the "maybe we have too many services
now" stage.

This is the job I learned the most at. Code review was serious, people cared
about idempotency and exactly-once semantics, and I had to actually understand
distributed transactions instead of hand-waving. I also got my first real taste
of being on call for something that pages you at 3am because a processor webhook
was delayed.

Why I left: the startup did a layoff after a down round, and while I survived
it, half my team didn't and the roadmap got gutted. I started looking and Orbit
offered more money and a calmer environment. In hindsight I traded growth for
stability, which I'm now second-guessing.
