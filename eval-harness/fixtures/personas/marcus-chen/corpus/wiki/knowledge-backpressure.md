---
uri: wiki://knowledge/backpressure
title: Queues, workers, and backpressure
kind: wiki
tags: [knowledge, queues, scalability]
---

The queue-plus-worker-pool shape is the backbone of most async backend work I've
done: producers put work on a queue, a pool of workers consume it, and you scale by
adding workers. The notification pipeline is exactly this (see
[[Notification Pipeline (Orbit)]]), and so was the event bus migration (see
[[Moving notifications onto the event bus (Orbit)]]).

What I learned beyond the happy path:

- **Backpressure** — if producers outrun consumers forever, something has to give.
  Either the queue grows unboundedly (and you fall over later) or you push back /
  shed load. Bounding the queue and alerting on depth is the boring fix.
- **Blast-radius caps** — one bad producer shouldn't starve everyone; per-event
  fan-out caps were my version of this (see
  [[Fan-out and per-event caps]]).
- **Poison messages** — one un-processable item shouldn't wedge a worker forever;
  that's what dead-letter queues are for (see [[Retries, backoff, and dead-letter queues]]).

It's a simple pattern that's easy to get 80% right and surprisingly deep in the last
20%, which is the failure modes.
