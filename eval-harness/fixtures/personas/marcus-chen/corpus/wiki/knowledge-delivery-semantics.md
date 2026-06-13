---
uri: wiki://knowledge/delivery-semantics
title: At-least-once, at-most-once, exactly-once
kind: wiki
tags: [knowledge, messaging, distributed-systems]
---

The three delivery guarantees, and the honest truth that "exactly-once" is mostly a
lie you approximate.

**At-most-once** — fire and forget; a message can be lost but never duplicated.
Fine for things you don't mind losing.

**At-least-once** — retry until acked; never lost, but can be delivered twice. This
is what most real systems give you, including the queues I worked with.

**"Exactly-once"** — what everyone wants. In practice you get at-least-once
delivery plus idempotent processing on the consumer, which together *behave* like
exactly-once. The dedup step in the notification pipeline (see
wiki://project/notification-pipeline/dedup) and idempotency keys (see
wiki://knowledge/idempotency) are exactly this trick — assume duplicates will
happen and make them harmless.

Where I'm fuzzy: the deep guarantees of specific brokers (Kafka's exactly-once
semantics) I know more by reputation than from having implemented them.
