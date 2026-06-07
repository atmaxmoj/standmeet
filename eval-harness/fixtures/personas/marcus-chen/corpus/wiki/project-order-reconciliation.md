---
uri: wiki://project/order-reconciliation
title: Payment Reconciliation Pipeline (FlowPay)
kind: wiki
tags: [project, fintech, golang, kafka, postgres, idempotency, reconciliation, deep-dive]
---

The project I'm proudest of. At FlowPay, money flowed through external
processors (Stripe, Adyen), and our internal ledger was supposed to match what
they reported. It didn't always — webhooks arrived late, out of order, or twice;
refunds and chargebacks came back days later; and a finance analyst was manually
reconciling in a spreadsheet, finding discrepancies a week after they happened.

I designed and built the automated reconciliation pipeline over about four
months. The shape: processor webhooks landed in a Kafka topic, a consumer
normalized each event into a canonical "settlement record" in Postgres, and a
reconciliation job matched settlement records against ledger entries on a
composite key (processor id + amount + currency + a time window). Mismatches
went into an exceptions table with a reason code that finance could work.

The hard parts, honestly:
- **Idempotency.** Processors retry webhooks. I keyed on the processor's event
  id with a unique constraint and an upsert, so a duplicate webhook was a no-op.
  Took me two tries to get right — my first version had a race where two
  consumers processed the same event and both passed the existence check before
  either wrote.
- **Late and out-of-order events.** A refund could arrive before I'd even
  recorded the original charge. I made the matcher tolerant: unmatched records
  stayed "pending" and got re-evaluated on a schedule rather than failing.
- **Time windows.** Settlement timestamps and ledger timestamps never matched
  exactly, so the join had a fuzzy window. Picking the window was empirical —
  too tight and we got false mismatches, too loose and we matched the wrong
  transactions. I landed on 48 hours after looking at the distribution.

Impact: reconciliation went from a weekly manual process to near-real-time, and
we caught a processor bug that had been silently dropping ~0.1% of refund events.
What I'd do differently: I under-invested in observability at first and debugged
mismatches by hand for weeks before I added proper metrics on the exception
reasons. I should have built the dashboard first.

Limits of what I know here: people ask me about exactly-once semantics and I'm
honest that what I built is effectively at-least-once delivery plus idempotent
processing, which gets you effectively-once. True exactly-once across systems is
a much harder problem I haven't solved.
