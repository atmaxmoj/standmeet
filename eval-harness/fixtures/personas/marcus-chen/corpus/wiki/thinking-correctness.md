---
uri: wiki://thinking/correctness
title: Correctness over cleverness
kind: wiki
tags: [thinking, philosophy, correctness]
---

Working at FlowPay where bugs moved real money rewired how I write code. A clever
solution that's subtly wrong is worse than a plain one that's obviously right,
because the clever one fails in ways nobody predicted at 2am.

In practice this means I write the boring explicit version first, I lean hard on
types and tests to make wrong states unrepresentable, and I'm suspicious of code
that's impressive to read. The double-charge incident (see
wiki://lessons/double-charge-incident) was a clever-ish retry that was wrong in one
path, and it cost real money and trust.

I'm not dogmatic — cleverness has its place in hot paths and genuine constraints.
But the default should be the version the half-asleep on-call engineer can
understand, because that engineer is often me.
