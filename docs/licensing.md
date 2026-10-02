# License strategy: layered dual licensing

## Background: why not all MIT

MIT lets anyone take the code into a closed-source commercial product without contributing back. That is exactly what led to Tencent scraping ClawHub to build SkillHub — fully legal under MIT, but zero contribution to the community.

The OpenClaw lesson: MIT is too permissive for personal-tool projects. Big companies' business model is closed-source modification of open-source projects, and MIT does nothing to stop it.

---

## Three license layers

```
Protocol specs — MIT
  ├── CloudEvents event type definitions
  ├── JSON Schema (Playbook/Episode/Rating/...)
  ├── REST API spec
  └── Organization Protocol spec

  Why MIT:
    Protocols must be fully open, or nobody will implement them.
    Wide adoption of the protocols helps us — the higher the adoption, the bigger the ecosystem.
    A big company builds its own implementation of the protocols? Good — it shows the protocols have value.
    The protocols themselves have no commercial value; the value is in the implementation and the data.

Personal stack implementation — AGPL v3
  ├── Capture adapters (Screenpipe adapter, IDE plugins, etc.)
  ├── Signal filtering engine
  ├── Distillation engine (multi-layer pipeline)
  ├── Memory store (SQLite backend)
  ├── Playbook rating system
  ├── Execution engine (personal)
  └── Reference implementation (full-stack personal edition)

  Why AGPL:
    Individual users: completely free, normal use, no restrictions at all.
    Community contributors: fork, modify, send PRs — all normal.
    A big company wants to modify it: allowed, but the modifications must be open-sourced under AGPL.
    A big company wants to turn it into a closed-source service: not allowed; AGPL counts network interaction as distribution.
    → The big company's options:
      a. Follow the AGPL and publish all modifications → the community benefits
      b. Buy a commercial license (dual licensing) → we make money
      c. Don't use it → we lose nothing

  AGPL's deterrent power:
    Google explicitly bans AGPL code internally.
    Tencent's and ByteDance's legal teams will also block it when they see AGPL.
    → Either contribute or pay; there is no third way.

Organization layer — commercial license (proprietary)
  ├── Organization distillation engine (aggregates many people's Agent Cards + Flow Records)
  ├── Capability map visualization
  ├── Cross-person task scheduling
  ├── Organization Playbook management
  ├── Enterprise features (knowledge retention on departure, best-practice diff, hiring suggestions)
  └── Hosted service (API key management, usage billing)

  Why proprietary:
    The organization layer needs a centralized service; it cannot be purely local, technically.
    This is a natural paywall — not an artificial limit, but one decided by the architecture.
    Open protocols → third parties can build their own organization layer (under AGPL or another license).
    Our commercial advantage is not a protocol monopoly; it is the best implementation + the earliest accumulation of user data.
```

---

## Dual licensing business model

```
For individual users and small teams:
  Free under AGPL, no restrictions at all.
  Bring your own API key; distillation costs ~$10-17/month, paid by the user.

For enterprises (that don't want to open-source their modifications):
  Buy a commercial license, billed annually.
  Closed-source deployment, closed-source modification, no obligation to publish code.
  Includes technical support and an SLA.

For enterprises (that need organization features):
  Organization layer SaaS, $30-50/person/month.
  Includes a commercial license (right to deploy the personal stack closed-source).

Pricing references (companies with the same model):
  GitLab: AGPL community edition free, enterprise edition $29/person/month
  Grafana: AGPL community edition free, enterprise edition $29/person/month
  Sentry: BSL community edition free, enterprise edition $26/person/month
```

---

## Precedents

| Company | Community license | Commercial license | Outcome |
|------|---------|---------|------|
| GitLab | AGPL (CE) | Proprietary (EE) | $4B+ market cap; big companies pay without complaint |
| Grafana | AGPL | Proprietary | $6B+ valuation; AWS forced to use the AGPL edition |
| MongoDB | SSPL | Commercial | Pushed AWS to build DocumentDB (its own rewrite); $20B+ |
| Sentry | BSL | Commercial | Big companies either wait 3 years or pay |
| HashiCorp | BSL | Commercial | Acquired by IBM for $4B |

AGPL is the most mature choice — more accepted by the community than BSL/SSPL (it is an OSI-approved open-source license), while still deterring big companies enough.

---

## How the license relates to the protocol layer

```
The license protects the "implementation" (code).
The protocol protects "interoperability" (interfaces).

The two are independent:
  Protocol MIT → anyone can write their own implementation
  Implementation AGPL → if you use our code, your modifications must be open-sourced

  Big company option A: use our protocol + write its own implementation from scratch → fully legal, no restrictions
  Big company option B: fork our code and modify it → must open-source the modifications under AGPL
  Big company option C: buy a commercial license → may modify closed-source

  Option A is the one we encourage — the higher the protocol adoption, the better.
  If a big company is willing to spend engineering resources implementing from scratch, the protocol is well designed.
  Their implementation will also end up driving the protocol's evolution.
```
