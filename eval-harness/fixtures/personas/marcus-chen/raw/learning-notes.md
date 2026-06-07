---
uri: raw://learning-notes
title: what I'm currently learning (scattered)
kind: raw
tags: [learning, growth, distributed-systems, rust, raw-thought]
---

scattered notes on what I'm actively trying to get better at, since "I want
growth" is empty without specifics.

DDIA (Designing Data-Intensive Applications) — second pass, doing it properly
this time. the chapters on consistency models and consensus are the ones where I
feel the gap most. I can now explain the difference between linearizability and
serializability without looking it up, which I couldn't a year ago. Raft I
understand at a "could explain it" level, not a "could implement it" level.

Rust — dabbling. did the book, wrote a toy CLI. the borrow checker fights me and
I'm slow, but I like that it makes me think about ownership explicitly. not
production-ready in it, wouldn't claim it on a resume as a skill, would claim it
as "learning."

distributed systems generally — I've been reading the classic papers (Dynamo,
the Google ones) and Aphyr's Jepsen posts, which are humbling. every time I think
I understand a consistency guarantee, Jepsen shows me a way it breaks.

things I keep meaning to learn and haven't: real Kubernetes (beyond deploying),
proper streaming systems (Flink-style), and I'd like to actually understand how a
query planner works instead of just reading its output.

the honest meta-point: I'm a better engineer than I was two years ago but I'm
learning on my own, which is slower and lonelier than learning from strong
colleagues. that's a big part of why I want a team that's ahead of me.
