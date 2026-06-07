---
uri: raw://thoughts/testing-and-ai
title: testing philosophy + AI coding (raw)
kind: raw
tags: [opinion, testing, ai-coding, raw-thought, technical-views]
---

two things I have opinions on that come up in interviews.

TESTING. I'm a pragmatic-not-dogmatic tester. I don't chase 100% coverage, that
number is a lie. I write tests where the cost of being wrong is high (anything
touching money — at FlowPay I tested the ledger code paranoidly) and I'm lighter
on stuff that's easy to verify by eye or cheap to fix. I lean toward fewer,
higher-value integration tests over a million brittle unit tests with mocks for
everything. mocks that assert on implementation details are how you get a test
suite that breaks every refactor and tests nothing real. I learned that the hard
way maintaining a suite at ACME where every change broke 50 tests.

AI CODING. I use Copilot and Claude daily and they've genuinely changed how I
work — great for boilerplate, for unfamiliar APIs, for "write the test for this".
but I'm wary. I've caught the AI confidently producing subtly wrong concurrency
code and SQL that looked right and had an N+1. the failure mode is it's *plausible*,
which is more dangerous than obviously wrong. my rule: I have to understand every
line it writes well enough that I'd have been able to write it myself, just
slower. the day I'm pasting code I don't understand is the day I'm in trouble.
where I'm genuinely unsure: whether juniors coming up now will develop the deep
understanding if the AI does the reps for them. I don't have a confident answer.
