# deploy-forks — Prod deploy-config forks

- **Module:** The prod-default branches that CI never runs, because CI sets a different value. Each one behaves correctly, or is named clearly enough that nobody assumes the dev behaviour in prod.
- **Surface:** The running prod compose config, and the code branches it selects. No owner screen.
- **Real dep:** A running prod stack. This is observation: read each key and diff it against the dev compose.
- **Backing e2e:** `plugin-discovery-chat` · `real-third-party-mcp-loader` · `agent-turn-endpoint` · `security-captcha-bypass`.

## Checks

### 1 — With the plugin path unset, no platform plugin loads ⭐
- **Steps:** Read the prod backend's environment and confirm the plugin-path variable is absent. Boot and list what registered. Then register a real owner-side plugin and use it in visitor chat.
- **Expected:** No platform-declared plugin registers at boot. An owner-registered plugin still discovers and dispatches.
- **Mock gap:** Dev sets the variable, so the whole platform-plugin discovery path CI exercises runs on a source that does not exist in prod.
- **Backing test:** `plugin-discovery-chat.spec.ts` · `real-third-party-mcp-loader.spec.ts`

### 2 — The turn timeout falls to the code default
- **Steps:** Confirm prod sets no turn-timeout override. Drive a genuinely long turn and watch where it stops.
- **Expected:** The turn caps at the code default, and exceeding it produces the engineered boundary rather than a crash (see [[agent-turn-boundary]]).
- **Mock gap:** CI validates the timeout error path only under a short override, so the real default branch is never driven.
- **Backing test:** `agent-turn-endpoint.spec.ts`

### 3 — Captcha is off by default, and that is deliberate
- **Steps:** Confirm neither compose sets the captcha keys. Open `/gate` and look for a widget. Trip the IP lockout.
- **Expected:** No widget renders, because the provider resolves to none. The IP hard-lock still guards. This is a permissive default the owner opts into (see [[captcha]]), so it must be named rather than assumed.
- **Backing test:** `security-captcha-bypass.spec.ts`

### 4 — Every other prod-only value is read, not assumed
- **Steps:** Diff the prod compose against the dev one key by key. For each difference, name which code branch it selects and where that branch is covered.
- **Expected:** Every divergence is either covered somewhere or written down as a known fork. Storage and isolation specifics belong to [[corpus-media]] and [[sandbox]].
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

This module has no screen — the thing to look at is whether each fork is named anywhere an operator would find it.
An unnamed fork becomes an assumption, and the assumption is always the dev value.
