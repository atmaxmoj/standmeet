---
uri: wiki://work/kestrel/ingest
title: Log ingest service at Kestrel
kind: wiki
tags: [work, kafka]
---
Built the Kafka ingest service from scratch: consume device logs, filter, convert, tag, store.
Each product line's log format is a pluggable parser module behind one interface, so a new
source is a new module rather than a change to the pipeline.
