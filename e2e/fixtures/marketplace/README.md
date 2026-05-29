# marketplace fixtures

Skill marketplace snapshots served by `cmd/job-board-mock` so dev/e2e
runs against deterministic data instead of hitting the real upstreams.

## Layout

```
e2e/fixtures/marketplace/
├── capture.sh          # fetch fresh snapshots into .raw/
├── trim.sh             # trim .raw/ → committed git path
├── github/             # captured (real) GitHub anthropics/skills listing
│   └── contents.json
└── skillsmp.json       # hand-rolled fixture — no public api.skillsmp.com exists
```

## Updating

```
make capture-marketplace-fixtures   # refresh real GitHub snapshot
make trim-marketplace-fixtures      # write committed copy
```

## What lives where

- **github/contents.json** — exact response shape from
  `GET https://api.github.com/repos/anthropics/skills/contents/skills`,
  trimmed to `{name, type, html_url}` per entry.
  The marketplace package only reads those three fields.
- **skillsmp.json** — design's hypothetical commercial channel. We commit
  a 3-skill fixture matching the design's MARKET array so e2e + manual
  testing of the source filter actually have something to filter. If a
  real SkillsMP service ships later, capture replaces this with a fetched
  snapshot the same way GitHub does.

## Why not just hit upstream from tests

GitHub's anonymous rate limit (60 req/h) tanks parallel e2e runs;
captured fixtures keep tests deterministic and offline-friendly.
