---
uri: wiki://profile/skills/kubernetes
title: Kubernetes — operate, not architect
kind: wiki
tags: [skills, kubernetes, infrastructure]
---

Honest version, because this is a common interview trap: I can operate in
Kubernetes, I can't architect it.

What I can do: read and edit a deployment/service/ingress manifest, understand
pods/replicasets/services, use kubectl to debug a crash-looping pod, figure out
why something got OOM-killed from its limits, and set up liveness/readiness probes.
At Orbit our services run on it and I deploy daily without drama.

What I can't do: I've never stood up or run a cluster, I don't deeply understand
the networking (CNI, service mesh) or the control plane, and I'd be out of my depth
designing the platform itself. We have an infra team for that and I'm glad.

If a job needs someone to ship services onto an existing cluster, I'm fine. If it
needs someone to own the cluster, that's not me yet.
