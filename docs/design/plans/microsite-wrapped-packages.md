# Plan — a microsite uses a package or font we did not ship

Status: 2026-10-01, plan. Implements `docs/design/plugin/microsite-build.md` ("the node packages
arrive WITH the block") and the two owed specs in `everything-is-a-block-tests.md`.

## Facts found

- `blocks.install` stores only manifest text (`installed_blocks`); no block directory exists on disk
  for an owner-installed block. `ParseManifest` is non-strict YAML; a data-only block is legal.
- The `microsites_data:/srv/microsites` volume is shared by backend and builder in every compose
  file. Public serving resolves only `<page_id>/<build_id>/dist` from DB rows, so `_blocks/` there is
  never served.
- The mock stack already serves npm (`mock-stack/job-board/npm.go`, `BLOCK_MARKET_NPM_BASE_URL`).
- `resetInstance()` does not clear the volume, so the claim must carry the package list from the DB.

## Steps

1. Manifest field `package: <name>@<version>` (`plugin/manifest.go`). Validate in `ParseManifest`:
   registry spec only (no `file:`, `git+`, URL, `..`); the block id must be dir-safe.
2. `blocks.install` wraps before persisting (`blockwire/npm_wrap.go`):
   `npm install <spec> --prefix <tmp> --ignore-scripts --omit=dev --no-audit --no-fund
   --registry <BlockMarket registry>`, then rename into `<BuildsRoot>/_blocks/<id>`. A failure
   refuses the install with npm's last lines. No pre-bundle step: vite bundles it per build.
3. Uninstall removes `<BuildsRoot>/_blocks/<id>`.
4. The build claim carries `blocks: [ids]` — the owner's installed blocks with `package` set.
5. `builder/runner.mjs` copies `_blocks/<id>/node_modules/*` into the work `node_modules`, only
   where the target does not exist (the shipped floor always wins).
6. Mock npm: a table of packages — `sm-fixture-pristine` (a `postinstall` that rewrites
   `index.js`) and `sm-fixture-font` (CSS + a real woff2).

## Specs (`e2e/test/microsite-wrapped-package.spec.ts`)

1. Wrapping runs no install scripts. Control: a host `npm install` with scripts ON produces
   `POSTINSTALL_RAN`. Then install the block, publish a page importing the package, assert the page
   text is exactly `PRISTINE`.
2. A page uses a font we did not ship. Before install, the build fails naming the package. After
   install, the build succeeds; computed `color` and `fontFamily` match, and the `FontFace`
   reaches `status === 'loaded'` (not `fonts.check()`, which is true for missing faces).

## Risks

- Package code still runs at build time in the SSR prerender — the same trust class as owner code.
- Every wrapped package is importable from every page of the owner (no per-microsite selection
  until microsites get a bundle).
