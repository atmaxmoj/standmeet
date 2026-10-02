# Theoretical Foundations: Coalgebraic Behavioral Distillation

## Abstract

StandMeet's distillation system is not just an engineering pipeline — it is working on a mathematical problem: **from a finite set of behavioral observations, construct a model that can reproduce the user's behavior in situations it has not seen**. Coalgebra is the natural mathematical language for this problem.

This document sets up the theoretical framework for the distillation system. The goal is not formal verification, but:
1. To give engineering design precise conceptual tools (what does "distillation succeeded" mean?)
2. To use theory to guide harness design (what to observe, how to observe it, how to know whether the observation is enough)
3. To expose structural limits that engineering intuition tends to miss

---

## 1. The User as a Coalgebra

### Basic model

The user is a stateful behavioral system. Given a situation (input), it produces an action (output), and its internal state transitions at the same time. This is a Mealy machine coalgebra:

```
user-coalgebra  α: S → (O × S)^I

S = the user's internal state space (unobservable, possibly infinite-dimensional)
    including: knowledge, mood, fatigue, recent experiences, long-term preferences...
I = the situation space (receiving an email, hitting a bug, being asked a question, choosing a technology...)
O = the action space (reply, ignore, forward, look it up before replying, write a test...)

α(s)(i) = (o, s')
in state s, on meeting situation i → perform action o, transition to state s'
```

Key point: S cannot be observed directly. We can only see the sequence of (i, o) pairs — the **trace** of the user-coalgebra.

### Why coalgebra and not algebra

```
Algebra   = construction view: how to assemble parts into a system      F(A) → A
Coalgebra = observation view: how to understand a system's behavior from outside   A → F(A)
```

We do not take the user's brain apart — we model the user by observing behavior. This is exactly the coalgebraic stance, and also Ashby's stance: "cybernetics treats not things but ways of behaving".

---

## 2. Bisimulation as the Success Criterion

### Definition

The goal of distillation is to construct an agent-coalgebra:

```
agent-coalgebra  β: T → (O × T)^I

T = the agent's state space = (Playbook, Identity, Episodes, CurrentContext)
```

such that β and α are **bisimilar**:

```
R ⊆ S × T is a bisimulation relation if and only if:
  for all (s, t) ∈ R, for all situations i ∈ I:
    if α(s)(i) = (o, s') and β(t)(i) = (o', t')
    then o = o' and (s', t') ∈ R
```

Intuition: on the state pairs related by R, the user and the agent do the same thing in every situation, and the successor states after the action are still related.

### Why bisimulation and not trace equivalence

Trace equivalence only requires the historical behavior sequences to be the same. Bisimulation is stronger — it requires the behavior to be the same on **all future branches**.

```
Trace equivalence: alike in the past → but not necessarily alike in the future
Bisimulation: alike in the past + alike in the future too

Distillation wants the latter — not to "replay" the user's history, but to "act like the user" in new situations.
```

### Finite approximation

Full bisimulation is not achievable (S is unobservable, I may be infinite). What we actually pursue is:

```
ε-bisimulation on I' ⊆ I

on the observed subset of situations I', the deviation between the agent's behavior and the user's behavior is ≤ ε
```

Skill maturity is the measure of this approximation:

```
nascent:    |I'| is too small, bisimulation cannot be meaningfully established
developing: bisimulation partly holds on I' (ε is fairly large)
mature:     bisimulation largely holds on I' (ε is small)
mastered:   I' contains boundary situations and counterexamples, and bisimulation still holds
```

Ashby coverage = |I'_verified| / |I_observed|, the ratio of the domain where bisimulation is verified to the observed domain.

---

## 3. Harness and Functor

### The harness defines the functor

Harness = the observation framework (Screenpipe + signal filtering + local tools + episode boundary detection).

The design choices of the harness define the functor F:

```
F determines:
  what counts as one "observation" (screen text? git commit? mouse trajectory?)
  what granularity (seconds? tasks? days?)
  what counts as one "situation" (how are task boundaries cut? what context is included?)
  what counts as one "action" (one commit? one stretch of input? one choice?)
```

A different harness → a different F → a different notion of bisimulation.

### F sets the upper bound on bisimulation

```
Theorem (informal):
  The finest bisimulation a harness H can support cannot be finer than the resolution of F_H.
  If two behaviors are indistinguishable under F_H, they stay bisimilar forever, no matter how much data accumulates.
```

Example:

```
Harness without git_log:
  under F₁, "writing a new feature for 1 hour" and "refactoring for 1 hour" are bisimilar
  → Screenpipe only sees typing in VS Code

Harness with git_log added:
  under F₂, they are no longer bisimilar
  → git log distinguishes a feat commit from a refactor commit
```

Adding a tool is not "adding data"; it changes F, and so changes which behaviors are distinguishable.

### Auto-discovering local tools = automatically choosing the richest available F

```
an engineer's F = F_screenpipe × F_git × F_shell × F_docker
a lawyer's F    = F_screenpipe × F_browser × F_calendar
a designer's F  = F_screenpipe × F_figma × F_file_changes

different F → different induced bisimulation → different Playbook structure
```

This explains why the Playbook emerges from the system rather than being preset — F differs from person to person, F determines which behavior patterns are distinguishable, and only distinguishable patterns can become Playbook entries.

### Signal filtering = a quotient of the functor

The signal filtering layer (dropping mouse movement, page scrolling, app switches under 3 seconds) deliberately takes a quotient of F:

```
F_raw = raw Screenpipe output
F_filtered = F_raw / ~    (taking equivalence classes over noise behaviors)
```

Tradeoff: the coarser F is → the easier bisimulation is to establish, but the less precise. The finer F is → the more precise, but more data is needed.

The multi-layer distillation pipeline works on F of different coarseness:

```
Second level: F finest (keystroke level) → micro-operation traits
Task level:   F medium (task boundaries) → methodology
Day level:    F coarser (daily aggregation) → decision style
Week level:   F coarsest (weekly aggregation) → underlying patterns

Each layer is a quotient functor of the layer above. Each layer's bisimulation is coarser than the layer above but more stable.
```

---

## 4. Dual Structure: Distillation and Execution

### Bisimulation-targeted design (distillation layer)

Bisimulation is the target. This target drives the design of the harness:

```
"To reach behavioral bisimulation with the user,
 what should I observe? How should I cut episodes? How should the Playbook be organized?"

α (user) → observe → build β such that β ~bisim~ α
               ↑
               bisimulation as the objective function
               determines the choice of F (what to observe, what granularity)
               determines the structure of the Playbook (how situations are cut, how actions are encoded)
```

### Harness-induced bisimulation (execution layer)

At execution time, the harness constrains the agent's behavior and induces a concrete bisimulation:

```
β (agent) → harness constraints → behavior output
              ↑
              the Playbook defines the legal (situation → action) mapping
              Identity defines the boundary of the action space
              the confidence threshold defines the effective domain of the bisimulation
              → the harness restricts the agent's behavior to within the bisimulation relation
```

The harness does not "hope the agent acts like the user"; it **forces the agent to behave consistently with the user within the domain the Playbook covers**. Inside the covered domain, the induced bisimulation is guaranteed, not verified.

### Convergence of the two sides

System quality = whether these two sides converge:

```
the bisimulation the distillation layer aims for ("I want the agent to act like the user in these situations")
  ≈
the bisimulation the execution-layer harness actually induces ("the agent actually acts like the user in these situations")

The gap comes from:
  1. F resolution is not enough → the distillation layer aims finer than the harness can induce
  2. Not enough data → the bisimulation holds on a finite trace but does not generalize
  3. Non-stationarity → the user changed, but the harness still induces the old bisimulation
```

### Inside vs outside the covered domain

```
inside the harness's covered domain: the bisimulation is induced (guaranteed)
  the Playbook has an entry + confidence ≥ 0.8 → the agent acts according to the Playbook
  behavioral equivalence is guaranteed by the harness structure

outside the harness's covered domain: the bisimulation is conjectured (a guess)
  the Playbook does not cover it → rely on Identity reasoning + Episodes retrieval
  behavioral equivalence rests on the LLM's ability to generalize; there is no structural guarantee

mature Playbook = the induced bisimulation has a large domain
nascent Playbook = the induced bisimulation has a small domain; most of it relies on conjecture
```

---

## 5. Bisimulation-driven Harness Design

The quality of the bisimulation is observable. Each time the agent's behavior differs from the user's behavior is one bisimulation failure. These failures are diagnostic signals that point to specific directions for improving the harness.

### Classifying bisimulation failures

#### Derivation

Bisimulation failure = on some situation i, α(s)(i) produces o, β(t)(i) produces o', and o ≠ o'.

Whether bisimulation holds depends on four components: F (the functor / observation framework), I (the partition of the situation space), β (the agent-coalgebra / the learned model), α (the user-coalgebra / the user themself).

If F is fine enough, I is partitioned correctly, β has converged from enough data, and α has not changed, then bisimulation necessarily holds. So a failure necessarily comes from at least one of these components. Four components → four types of failure, and the list is exhaustive:

```
Component  What the failure means                                          In engineering terms
────────────────────────────────────────────────────────────
F          a behavioral difference exists but the framework sees no signal  hidden variable outside the observation range
I          the framework saw the signal but the situation encoding didn't use it  a Playbook entry should have been split but wasn't
β          F and I are both enough, but the model hasn't converged from enough data  not enough samples
α          F, I and β are all right, but the user themself changed          environment / habits / tools changed
```

Mutual exclusivity: the types are not fully mutually exclusive; in practice several components can go wrong at once. But diagnosis has a priority order — first rule out α having changed (look at the confidence trend over time), then rule out β not having converged (look at the sample size), and finally distinguish F from I (look at the within-entry variance pattern).

---

**Type 1: F is not enough (functor resolution is not enough)**

```
Signal: in the same Playbook situation, the user sometimes does A and sometimes does B
        the agent cannot predict which time will be A and which B
Diagnosis: there is a hidden state variable that F does not capture
           the user's behavior depends on some dimension F cannot see

Example:
  situation "received a client email": the user sometimes replies within seconds and sometimes waits a day
  F_screenpipe cannot see the reason
  after adding F_calendar it turns out: they wait when there is a deadline that day, and reply instantly when free
  → the hidden variable is "schedule pressure that day"

Harness improvement:
  add an observation tool (extend F) → F' = F × F_new
  or refine the situation encoding → encode the hidden variable explicitly into the situation space I
```

**Type 2: I is too coarse (the situation space is not cut finely enough)**

```
Signal: a Playbook entry has been observed many times but its confidence won't go up
        the behavioral variance within the entry is large
Diagnosis: this entry covers several situations that should be distinguished
           the partition of I is too coarse; several different situations were merged into one

Example:
  the "debugging" entry, confidence stuck at 0.6
  further analysis: frontend bugs and backend bugs are handled completely differently
  → "debugging" should be split into "frontend-debugging" and "backend-debugging"

Harness improvement:
  add a situation dimension → I' = I × D (D is the new distinguishing dimension)
  split the Playbook entry
```

**Type 3: β has not converged (not enough data)**

```
Signal: the situation has only appeared 1-2 times
        confidence is low but not contradictory (not large variance, just few samples)
Diagnosis: not enough samples; the harness itself is fine

Harness improvement:
  wait for natural accumulation
  or ask proactively to speed it up ("What do you usually do in this kind of situation?")
  → this is Angluin L*'s membership query
```

**Type 4: α changed (non-stationarity)**

```
Signal: bisimulation used to hold, and now starts to fail
        the confidence of Playbook entries drops
        the deviation between the user's behavior and what the Playbook records keeps growing
Diagnosis: the user changed — switched tools, roles, or habits
           the functor F or the transition function α of the underlying coalgebra changed

Example:
  the user switches from Google Calendar to Notion Calendar
  all the entries in meeting-prep.md suddenly stop working
  it is not a data problem; the structure of the system changed

Harness improvement:
  drift detected → down-weight or archive the old entries
  observe again → rebuild the bisimulation under the new F
```

### Diagnostic flow

```
Bisimulation failure detected (agent behavior ≠ user behavior)
  │
  ├── Does this situation have an entry in the Playbook?
  │     │
  │     ├── No → Type 3 (not enough data) → wait or ask proactively
  │     │
  │     └── Yes → What is this entry's confidence trend?
  │           │
  │           ├── Always low (never was high) → Is the within-entry variance large?
  │           │     │
  │           │     ├── Large → Type 2 (not cut finely enough) → split the entry, add a situation dimension
  │           │     └── Not large but unstable → Type 1 (F too coarse) → find the hidden variable, extend F
  │           │
  │           └── Was high, now dropping → Type 4 (non-stationarity) → detect the change, rebuild
  │
  └── Diagnosis result is written to meta/gaps.jsonl
      → the weekly Opus run sees the diagnosis during analysis
      → and naturally makes the harness improvement (split entry / add situation dimension / archive old entries)
```

### Closed loop: bisimulation drives harness evolution

```
Observe user behavior
  → build the Playbook (bisimulation-targeted design)
    → the agent executes according to the Playbook (harness-induced bisimulation)
      → compare execution results vs user behavior
        → classify and diagnose bisimulation failures
          → improve the harness (extend F / refine I / rebuild entries)
            → back to observation
```

This closed loop is itself a cybernetic system:
- Controlled object = the design of the harness
- Sensor = bisimulation failure detection
- Controller = failure diagnosis + improvement strategy
- Actuator = Playbook updates / tool registration / situation re-encoding

Ashby's requisite variety also applies here: **the variety of diagnostic strategies must be ≥ the variety of failure types**. Four failure types, four improvement strategies — exactly enough.

---

## 6. Structural Limits

### Unreachable behavior

When a behavioral difference comes from an unobservable internal state, bisimulation is unreachable in principle:

```
The user argued with their partner yesterday → today the tone of their client emails is clearly different
This state variable is outside the observation range of any F
The Playbook will see "the same kind of email, sometimes friendly, sometimes cold"
→ confidence will never go up
→ it is not that the harness isn't good enough; it is theoretically unreachable
```

The theoretical basis for meta/confidence.json: some low confidence is not "hasn't learned enough yet" but "cannot be learned in principle". The system should be able to tell these two cases apart (Type 3 vs the non-extendable cases of Type 1).

### The fundamental tension of approximating stateful with stateless

```
The user-coalgebra is stateful: S → (O × S)^I
The Playbook is essentially stateless: I → O

The Playbook approximates distinctions in the state space S with subdivisions of the situation space I:
  α(s_pressure)(bug) = skip_test     →  playbook(bug_urgent) = skip_test
  α(s_normal)(bug)   = write_test    →  playbook(bug_normal) = write_test

Encode s into i. In many cases this is enough, but it has a fundamental limit:
  when a behavioral difference comes purely from internal state, with no externally observable signal,
  no subdivision of I can distinguish it.
```

The theoretical basis for the existence of Identity and Episodes: they supplement the Playbook's stateless mapping with a stateful approximation — Identity is a long-term stable summary of state, Episodes are vector retrieval of short-term state. Together the three approximate a stateful coalgebra.

### The fundamental limit of non-stationary systems

```
The standard coalgebra S → F(S) assumes F is fixed.
The user's F changes over time: F_2025 ≠ F_2026

A bisimulation learned on F_old may fail when applied to F_new.
Detecting the failure needs new traces — but if the agent is executing automatically and the user no longer does it themself,
there are no new traces to detect whether F has changed.
→ the bisimulation fails silently (the "execution drift" of second-order cybernetics)

Active perturbation (periodically dropping back to suggestion mode) = actively generating new traces to verify whether the bisimulation still holds.
This is not an engineering hack; it is a theoretical requirement.
```

---

## 7. Mapping to the Distillation System Design

| Theoretical concept | Engineering counterpart | Design implication |
|---------|---------|---------|
| User-coalgebra α | The user's real behavior | Not directly observable; only the trace can be seen |
| Agent-coalgebra β | Playbook + Identity + Episodes | A finite-state approximation |
| Functor F | Harness (observation framework) | Sets the upper bound on bisimulation |
| Quotient of F | Signal filtering layer | Deliberately coarsened to reduce noise |
| Bisimulation | Behavioral equivalence | The success criterion, not high confidence |
| ε-bisimulation on I' | Skill maturity | mature = small ε over a large domain |
| Bisimulation failure | Agent behavior ≠ user behavior | Four types of diagnostic signal |
| Type 1 failure | F too coarse | Add observation tools |
| Type 2 failure | I not cut finely enough | Split Playbook entries |
| Type 3 failure | Not enough data | Wait or ask proactively |
| Type 4 failure | Functor drift | Archive old entries, observe again |
| Coinduction | Incremental verification | No need to enumerate; extend step by step |
| Coalgebraic minimization | Playbook deduplication | Behaviorally equivalent entries should be merged |
| Final coalgebra | The "universe" of all possible behaviors | The Playbook is a finite approximation |
| Stateless ≈ stateful | Playbook + Identity + Episodes | Together the three approximate stateful |
| Non-stationarity | User change | staleness + active perturbation |
| L* membership query | Asking proactively | Ask where the bisimulation is uncertain |
| L* counterexample | DAgger (the agent got it wrong) | Use failures to improve the model |

---

## 8. Relationship to Cybernetics

Coalgebra and cybernetics are two formulations of the same thing in their core stance that "a system is defined by its external behavior" — the former gives a precise mathematical structure, the latter gives engineering intuition and design principles.

**Established correspondences:**

- Ashby's "a system is defined by its behavior, not by its structure" ↔ coalgebraic bisimulation. Bisimulation is exactly the precise formalization of "different inside but the same in behavior".
- Rutten's "Universal coalgebra: a theory of systems" explicitly positions coalgebra as a theory of systems.

**Where they meet in StandMeet:**

| Cybernetics | Coalgebra | StandMeet |
|------------|-----------|-----------|
| Black-box observation | A → F(A) | Inferring patterns from behavior |
| Requisite variety | Upper bound on F's resolution | The harness's observation capability |
| Feedback control | bisimulation failure → correction | DAgger + asking proactively |
| Execution drift | Non-stationary coalgebra | staleness + active perturbation |
| Observation changes behavior | No rigorous formalization yet | The user knows the system is learning |

**Not yet rigorously formalized (open questions):**

- Second-order cybernetics (the observer as part of the system) ↔ coalgebra of coalgebras? Needs more work.
- Autopoiesis ↔ final coalgebra? Some papers explore this, but there is no consensus.
- Law of requisite variety ↔ category-theoretic constraints? The rigorous statement of Ashby's law goes through information theory (channel capacity), and the direct bridge to coalgebra is unclear.
