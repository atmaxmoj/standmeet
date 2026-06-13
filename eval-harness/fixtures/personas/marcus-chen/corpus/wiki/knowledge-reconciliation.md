---
uri: wiki://knowledge/reconciliation
title: Reconciliation as a pattern
kind: wiki
tags: [knowledge, data-integrity, payments]
---

Reconciliation is comparing two sources of truth that *should* agree and surfacing
where they don't. In payments it's your internal ledger vs what the processor says
happened; the same shape shows up anywhere two systems hold overlapping state.

The pattern I learned at FlowPay (see [[Payment Reconciliation Pipeline (FlowPay)]]): pull
both sides for a window, match records by a shared key, and bucket the results —
matched, missing-on-one-side, amount-mismatch. The matched ones you ignore; the
mismatches are the product. The subtlety is timing — records that look "missing"
might just not have arrived yet, so you need a settle window before you alarm
(another flavor of eventual consistency, see [[Eventual consistency, in practice]]).

Why I like it as a concept: it's a safety net that assumes your systems *will*
drift instead of pretending they won't. It's the data-integrity equivalent of
defensive programming, and it caught real money discrepancies that no amount of
careful writing would have prevented.
