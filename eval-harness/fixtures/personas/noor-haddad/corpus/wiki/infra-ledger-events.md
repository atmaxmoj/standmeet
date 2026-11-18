---
uri: wiki://infra/ledger-events
title: ledger-events
kind: wiki
tags: [infra, kafka]
---
`ledger-events` is a Kafka topic with twelve partitions. At its 2022 peak it carried about
40 million messages a day. Every consumer of it has to be idempotent, because the producer
retries on timeout and duplicates are normal.
