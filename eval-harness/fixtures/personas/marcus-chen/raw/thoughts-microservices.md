---
uri: raw://thoughts/microservices
title: microservices opinions (half-baked)
kind: raw
tags: [opinion, architecture, microservices, raw-thought, technical-views]
---

half-formed thoughts on micro services because I get asked about it.

I've now seen both: ACME's slowly-decomposing monolith and FlowPay's "oops we
have 40 services and 25 engineers" mess. honestly the monolith was easier to work
in for a team that size. FlowPay's service sprawl meant a simple feature touched
4 services and 3 teams and the integration testing was a nightmare.

my actual take, which I'm not 100% sure is right: most companies adopt
microservices way too early, for org reasons (teams want autonomy) dressed up as
technical reasons (scaling). the scaling argument is usually fake — you can scale
a monolith a long way. the real driver is Conway's law and wanting independent
deploys.

where I think services genuinely earn their cost: when you have a real
team-boundary reason, or a component with genuinely different scaling/availability
needs (the payment path needs different guarantees than the analytics path). draw
the boundaries around those, not around every noun in the domain.

I'm aware this is a fashionable opinion now ("monoliths are back") and I should be
careful I'm not just pattern-matching to the trend. but it does match what I've
actually seen hurt. the thing I can't speak to: I've never worked somewhere big
enough that microservices were obviously necessary. so my sample is biased toward
places where they were premature.
