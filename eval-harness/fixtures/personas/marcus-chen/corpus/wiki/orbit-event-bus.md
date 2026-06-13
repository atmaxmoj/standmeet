---
uri: wiki://work/orbit/event-bus
title: Moving notifications onto the event bus (Orbit)
kind: wiki
tags: [work-experience, orbit, kafka, events, golang]
---

When I joined Orbit the notification pipeline (see [[Orbit — Backend Engineer (2023–present)]]) consumed a
single Redis stream. That was fine until two more teams wanted the same events —
billing wanted "integration failing", analytics wanted everything. Fanning out
from one consumer group got messy.

I didn't design the move to Kafka — a senior on the platform team did. My part was
migrating the notification workers to consume from the new topics without dropping
or double-sending anything during the cutover. I ran both the old Redis path and
the new Kafka path in parallel for two weeks, diffed their outputs with a
reconciliation script, and only flipped off the old path once the diff was empty
for a few days.

What I took from it: a cutover is mostly about being able to *prove* the new thing
matches the old thing, not about the new thing being clever. The boring
parallel-run-and-diff caught a couple of subtle ordering bugs I'd never have found
by reasoning about it.
