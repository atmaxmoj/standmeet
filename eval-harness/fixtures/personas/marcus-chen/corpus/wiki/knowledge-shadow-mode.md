---
uri: wiki://knowledge/shadow-mode
title: Shadow mode for safe migrations
kind: wiki
tags: [knowledge, migrations, deployment]
---

When you replace a system whose output is visible or expensive, "I think the new
one is right" isn't good enough. Shadow mode turns belief into evidence: run the new
system alongside the old, have it do all the work but *not* take the real action,
and diff its would-be output against the old system's actual output until the only
differences are ones you can explain.

I used this twice: migrating notification workers onto a new event bus (see
wiki://work/orbit/event-bus) and rolling out the rewritten notification pipeline
(see wiki://project/notification-pipeline/rollout). In both, the diff caught subtle
bugs — an ordering issue, a dedup that was actually correct where the old behavior
was wrong — that I'd never have found by reasoning.

It pairs naturally with feature flags (see wiki://work/orbit/feature-flags): shadow
first to build confidence, then flag the real action on gradually. It's the single
practice I'd most want to bring to a new team.
