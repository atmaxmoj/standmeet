---
uri: wiki://reading/raftkv
title: raftkv — reading notes
kind: wiki
tags: [reading, distributed-systems]
---
MIT, open-sourced 2025-03. Read from a full clone (12,400 commits), not from the docs.

The log-compaction design is the interesting part: snapshots are taken per shard and the leader
streams them in chunks, so a slow follower never blocks the write path. Membership changes use
joint consensus. The test suite injects partitions with a fake clock — worth copying.
