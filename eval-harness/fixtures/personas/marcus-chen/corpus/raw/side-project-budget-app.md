---
uri: raw://side-project/budget-app
title: the budget app I abandoned (raw)
kind: raw
tags: [side-project, golang, learning, raw-thought, unfinished]
---

my one real side project, half-dead now but I learned from it so it's worth a
note.

built a personal budgeting app — Go backend, Postgres, a little React frontend,
deployed on a $5 droplet. the actual goal wasn't the app (there are a thousand
budget apps), it was an excuse to do things I don't do at work: own the whole
stack, try event sourcing, set up my own observability from scratch.

what I actually learned:
- event sourcing is way more work than it looks and I probably didn't need it for
  a single-user budget app. classic case of me wanting to use the fancy pattern.
  good lesson in YAGNI, learned by violating it.
- doing my own ops (Caddy, Postgres backups, Grafana) gave me a much better feel
  for the infra layer I usually take for granted at work.
- frontend is genuinely hard and I have new respect for people who do it well.

why it's abandoned: I got it to "works for me" and then life happened and the
motivation that comes from a real user (I was the only user) ran out. it's still
running, I still log expenses in it sometimes.

I mention it in interviews honestly — including that I abandoned it — because
"I built a thing to learn X and here's what I'd do differently" is more real than
pretending I'm a side-project machine. I'm not. I have one real one and it's
half-finished.
