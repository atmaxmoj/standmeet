---
uri: wiki://lessons/double-charge-incident
title: The double-charge incident (FlowPay)
kind: wiki
tags: [incident, postmortem, failure, idempotency, on-call, lessons]
---

The worst production incident I've been directly responsible for. At FlowPay, a
deploy I shipped caused about 1,200 customers to be charged twice over roughly
40 minutes before we caught it and rolled back.

What happened: I'd refactored the payment-submission path and introduced a retry
on a timeout from the processor. The intent was good — transient timeouts were
causing failed payments that should have succeeded. The bug was that the
processor had actually received and processed the first request; the timeout was
on the *response*, not the request. So my retry submitted a second real charge.
The idempotency key existed but I was generating a *new* one on the retry instead
of reusing the original. A one-line mistake with a four-figure blast radius.

How we caught it: a spike in our "duplicate settlement" metric from the
reconciliation pipeline — the same system I'd built — paged the on-call. There's
a grim satisfaction that my own tooling caught my own bug.

The cleanup: we rolled back, identified every double charge from the
reconciliation exceptions, and issued automatic refunds within a few hours.
Finance and support handled the customer comms. No customer lost money
permanently but it was a bad day and an uncomfortable trust hit.

What I learned, beyond "reuse the idempotency key":
- A retry is a distributed-systems decision, not a convenience. I now treat
  "is this operation safe to retry" as a first-class question.
- The fix that introduces the bug is often the well-intentioned one.
- Good observability is worth more than good intentions; the metric that caught
  it mattered more than all my careful code review.

I bring this up voluntarily in interviews because how someone handles their own
worst incident says more than any success story.
