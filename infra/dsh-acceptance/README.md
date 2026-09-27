# dsh-acceptance — real-DSH acceptance tests for our blocks

**This directory is tests, not production.** It proves the owner's bar: every block in
`../plugins/` is a valid **dsh plugin**. Its unmodified code and its `cordis.patch.yml`
declaration install, mount on a **real DSH**, register their tools, and work, with **zero
adaptation**, exactly as if we were a third-party dsh plugin developer.

## What runs here

`make dsh-plugin-test` (from the repo root) runs `npm install` here, then `node run.mjs`.
`make dsh-plugin-test PLUGIN="caldav smtp"` runs only the named scenarios.

`run.mjs` uses only the commands DSH ships. For each `<name>.acceptance.yaml` it creates a
throwaway `DSH_HOME` and does these steps:

1. `npm pack` the subject directory. The tarball is the artifact a user installs.
2. `dsh plugin --profile acceptance add <tarball>`. DSH initializes a base-backed profile,
   checks the plugin's `@deepseek-ai/dsh` peer range against its own version, installs it with
   pnpm, and adds the bundle to `dsh.profile.bundles`. The driver checks both manifest entries.
3. `dsh --profile acceptance --dump-config`. The driver checks that every `expect.rows` id is
   in the composed tree.
4. `dsh --profile acceptance --patch probe.patch.yml`. The overlay mounts `probe.mjs` inside
   the booted tree. After the launcher's `appReady` signal, the probe records the registered
   services and tools, calls each `exercise` through `ctx.tools.execute`, writes
   `out/<name>/probe.json`, and exits through `ctx.appExit`. The driver checks
   `expect.services`, `expect.tools`, and that no exercise returned an error. It also fails
   when DSH reports a plugin as version-incompatible at startup.
5. `dsh plugin --profile acceptance remove <package>`. The driver checks that the dependency
   and the bundle left the profile, and that the rows left the composed tree.

The driver runs every scenario, prints PASS or FAIL for each, and exits 1 if any failed.
Command logs go to `out/<name>/*.log`. A failed scenario keeps its `DSH_HOME` and prints its path.

The profile is named `acceptance` on purpose. A block must work in a profile of any name, so its
`cordis.patch.yml` never names a profile path. An MCP-server block sets its server `cwd` to its
own installed directory. Node resolves that directory from the running profile's manifest:

```yaml
cwd: !!js "process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(ctx.get('profileContext').dir + '/package.json').resolve('<package>/package.json'))"
```

Each part is a fact DSH gives every patch. The Loader evaluates `!!js` as `with (ctx) eval(expr)`.
The launcher provides `profileContext` (with `dir`) before the tree mounts. DSH's own patches use
both `ctx.get('profileContext')` and `process.getBuiltinModule('node:path')`. DSH anchors a
relative path beside its patch file only for an inserted row's `name`, never for config values,
so a relative `cwd` does not work.

## Pins

- **DSH**: the `@deepseek-ai/dsh` devDependency in `package.json`. This is the only DSH pin.
  `run.mjs` refuses to run when the installed version differs from it.
- **pnpm**: the `pnpm` devDependency. `dsh plugin` forwards to the pnpm on `PATH`, and the
  profile's `pnpm-workspace.yaml` (`nodeLinker: hoisted`, `autoInstallPeers: false`) needs a
  pnpm that reads settings from that file. The driver puts `node_modules/.bin` first on `PATH`.

## Scenario files

- **`<block>.acceptance.yaml`** (ask-visitor, booker, caldav, fetch, google-calendar,
  mail-sender, retrieval, smtp, summarize) test a **real production block**. `subject.source`
  points **back at `../plugins/<block>`** (no copying).
- **`koishi/`, `everything/`, `fsmcp/`, `group-compose/`** are self-contained **demo / proof**
  blocks, not production capabilities. They prove the substrate can host a Koishi-ecosystem
  plugin, a third-party MCP server, and a cordis `group` composition. Their scenario has
  `subject.source: ./<name>`.
- **`real-blocks-group/`** composes two real blocks (caldav, smtp) into one `cordis:group`.
  Its patch rows name the block packages, which it declares as `peerDependencies`.

A scenario has `subject.source`, `expect.rows`, `expect.services`, `expect.tools`, and an
optional `exercise` list of `{ tool, arguments }`.

`subject.peers` is an optional list of local package directories. The subject declares these
packages as `peerDependencies`, and they are not on npm. Before step 2, the driver packs each one
and installs it with `dsh plugin --profile acceptance add --save-dev <tarball>`. DSH selects only
`dependencies` as bundle layers, so a peer stays a plain package: its own `cordis.patch.yml` does
not apply. DSH never applies a dependency's bundle patch transitively. A group that contains another
block's row therefore states that row in its own patch. Step 5 removes the peers with the subject.

## Version compatibility

Each subject declares the DSH versions it supports:

```json
"peerDependencies": { "@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.2.0-0" },
"peerDependenciesMeta": { "@deepseek-ai/dsh": { "optional": true } }
```

DSH checks this range at install and at every profile start, with prereleases included. A plugin
without the peer is admitted by every DSH version, so `run.mjs` fails a subject that has none.
The lower bound is the version this suite verifies. The `-0` upper bound also excludes `0.2.0`
prereleases. `optional` stops npm (`infra/plugins/provision.sh`) from installing all of DSH
into each block's `node_modules`; DSH ignores `peerDependenciesMeta` and still checks the range.
Raise the range when the pin in `package.json` moves and the suite passes on the new version.

## It never ships

`infra/dsh-acceptance/` is **excluded from every production image**: the repo-root
`.dockerignore` drops `infra/*` except `scripts` and `updater`, so no docker build context
includes it; the dev/prod compose bind-mount only `./infra/plugins`, never this directory; and
`infra/plugins/provision.sh` provisions only the real blocks in `../plugins` plus the demo
fixtures the sandbox e2e specs use. These tests exist only in their own DSH test home.

## A block's dsh declaration (`../plugins/<block>/cordis.patch.yml`)

Stays **with the block**. It is the block's dsh-mount identity (and what a dsh marketplace entry
would use), not test material. Two shapes, both zero-adaptation on our side:
- native cordis plugin (caldav): `name: standmeet-caldav-mcp` — dsh loads the package directly.
- MCP-server block (booker, …): `name: '@deepseek-ai/dsh-mcp-client'` — dsh's **own** standard
  bridge for adopting any MCP server; we only give it the launch command. No dsh-specific code
  lives in the block.
