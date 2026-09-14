# dsh-acceptance — real-DSH acceptance tests for our blocks

**This directory is tests, not production.** It proves the owner's bar: every block in
`../plugins/` is a valid **dsh plugin** — its unmodified code + its `cordis.patch.yml`
declaration mount on a **real DSH** instance, register their tools, and work, with **zero
adaptation**, exactly as if we were a third-party dsh plugin developer.

## What runs here

`make dsh-plugin-test` (from the repo root) installs `dsh-testkit` here (once) and runs each
`*.dsh-testkit.yaml` through a real DSH lifecycle (install → boot → register → exercise →
uninstall → reboot), on the local runner, writing evidence under `out/<name>/`.

- **`<block>.dsh-testkit.yaml`** (ask-visitor, booker, caldav, fetch, mail-sender, retrieval,
  summarize) — the test scenario for a **real production block**. Its `subject.source` points
  **back at `../plugins/<block>`** (no copying): dsh-testkit packs the real block, mounts it via
  the block's own `cordis.patch.yml`, and asserts the expected tools/services register.
- **`koishi/`, `everything/`, `fsmcp/`, `group-compose/`** — self-contained **demo / proof**
  blocks (not production capabilities): they prove the substrate can host a Koishi-ecosystem
  plugin, a third-party MCP server, and a cordis `group` composition. Their code lives here; their
  `<name>.dsh-testkit.yaml` has `subject.source: ./<name>`.

## It never ships

`infra/dsh-acceptance/` is **excluded from every production image**: the repo-root
`.dockerignore` drops `infra/*` except `scripts` and `updater`, so no docker build context
includes it; the dev/prod compose bind-mount only `./infra/plugins`, never this directory; and
`infra/plugins/provision.sh` provisions only the real blocks in `../plugins`, never anything here.
These tests exist only in their own dsh test stack.

## A block's dsh declaration (`../plugins/<block>/cordis.patch.yml`)

Stays **with the block** — it is the block's dsh-mount identity (and what a dsh marketplace entry
would use), not test material. Two shapes, both zero-adaptation on our side:
- native cordis plugin (caldav): `name: standmeet-caldav-mcp` — dsh loads the package directly.
- MCP-server block (booker, …): `name: '@deepseek-ai/dsh-mcp-client'` — dsh's **own** standard
  bridge for adopting any MCP server; we only give it the launch command. No dsh-specific code
  lives in the block.
