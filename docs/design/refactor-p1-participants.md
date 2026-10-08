# P1 refactors — who participates, measured before the change

Source: the refactor ledger (R1–R25, 2026-10-06), P1 rows. Rule: before a P1 refactor
starts, list the specs, unit tests, gates and evals it touches. Then the change is planned
against that list, and the list is the regression set. Measured 2026-10-07 on main
(v0.1.135); 780 e2e specs in total.

## Already done in code (the ledger and design docs are stale)

| item | evidence | what is left |
|---|---|---|
| R3 ownercore god package | commit f35e82c04 deleted `internal/owner/ownercore` | ~~remove `"ownercore"` from `tools/archcheck/main.go`~~ (gone, checked 2026-10-08); fix stale comments (`.go-arch-lint.yml`, `check-domain-facade-boundary.sh`, `check-core-agnostic.sh`, `mcphandle/server.go`, `blockwire/service.go`, `paritymanifest/*`); mark the "Owed" section in `backend-domain-modules.md` done |
| R4 booker policy dedup | commits 7f02bccc1, 8c405eafd, f614c08f3, a1d2f0876 deleted every host copy and the Go booker | one copy left: `infra/plugins/booker/booker-mcp.js`; inside it `doCancelByID` repeats `deleteBooking` |
| R13 everything-is-a-block (part) | CalDAV, Telegram and SMTP are blocks; `switch m.Protocol` is gone; the host-blind baseline is empty | persistence is still a host op (`plugin/blockstore`); two `.Register(` calls sit outside the door (`boot_deps.go`, `boot_wireup_microsites.go`); the supplier layer (`supplier_register.go`) remains |
| R15 bundle ACL (part) | the additive bundle gate exists (`registry/bundle_gate.go`), with migrations | see R15 below |

## Open items

| item | footprint | e2e specs | unit tests | gates | evals |
|---|---|---|---|---|---|
| R1 jobs / resume as blocks | `owner/jobs/` 84 files, ~12.6k lines; 4 fibers (jobs, resume, applications, assistant), 19 tools | 65 (job-fetch-*, resume-*, draft-*, composer-*, applications-*, integration-job-loop, norm-outward-*) | 10 in jobs/ + `blockload/resume_read_test.go` | 12 arch-lint components (36 mayDependOn lines); `tools/archcheck` submodule `jobs`; `check-host-blind-to-blocks`, `check-core-seals-only`; planned `check-no-core-capability-fibers` does not exist | `jobs_mcp.py` |
| R2 applications.commit as a dispatcher op | `jobsmcp/fiber_applications.go`, jobsuc applications usecase | 11 (applications-commit*, application-*, integration-job-loop, norm-outward-toolset, resume-draft-preview, resume-tool-gated-to-applications, resume-pdf-render) | `applications_commit_test.go`, `schema_valid_test.go` | `check-routes-via-dispatcher`, facadeparity Conform (the new op must declare a danger class: authority) | `jobs_mcp.py` |
| R9 routes/admin direct imports | 10 admin files import owner/corpus facades, ~68 call sites | auth/claim via fixtures in ~660 specs; obsidian 49; export/import/recovery 22; tree 5; keypairs 3 | `deps_wired_test.go`; dispatcher 3 | `check-routes-via-dispatcher` baseline (46 rows, 11 admin; `corpus_page.go` row no longer offends — delete it); `adminroutes.mayDependOn` in arch-lint | none |
| R12 connector declarations as data | **Switches done 2026-10-08**: supplier kind (`supplierKinds`), provided seam (`blockSeamProxies`), form kind (`credFormKinds`) and auth field type (`authFieldRoles`) are table rows; `check-connector-kinds-in-data` (with self-test) keeps the switches out. Ran `/supplier /cred /block` (217 tests) before and after: same 3 reds on both (supplier-check-failure-disconnects, supplier-openapi-mail form-encoded body, supplier-spec-from-url too-large), already red on main. Left: `openapi/binding.go` SeamContractOps; the per-seam typed proxies (`adapters/seam_*.go`, `sharedBlockSupplier`'s `switch beh.Seam()`, `Dispatcher.InvokeByID`'s `switch in.Seam`) — each seam builds a different Go type, so those stay code until seams speak one contract | 133 mention supplier (67 `supplier-*`); core: supplier-provider-agnostic, supplier-happy-matrix | adapters 4, blockwire 5, credform 1, blockseam 1 | `check-supplier-boundary`, `check-blocks-declare-in-data`, `check-connector-kinds-in-data` | booker/candidate/canned-host evals; dsh-acceptance mail-sender, smtp, google-calendar, caldav |
| R13 remainder | `plugin/blockstore` 753 lines; supplier layer | blockstore 15; CalDAV 11; Telegram 6 | blockstore 2, credmgr 1, nativekey 2 | `check-register-via-door`, `check-host-blind-to-blocks`, `check-hostops-via-desk`, `check-native-key-confined`, `check-supplier-boundary` | dsh-acceptance caldav, koishi |
| R15 bundle ACL additive | subtractive side live: `code_acl.go`, `codes_acl.go`, `api_keys_acl.go`, `visitor_role_snapshot.go`, `code_block_denials`, denial MCP tools; `block_connections` not moved to credential-manager storage | subtractive family 8 (acl-block-matrix, acl-skill-matrix, acl-corner-errors, acl-freeze-isolation, acl-frozen-product, acl-global-master, iam-role-raw-deny, visitor-chat-permissions-deny) — to be rewritten on purpose; additive 6 | registry 5, access/usecase 5, conversation/usecase 6 | no specific gate | experiment, ask, blocks.py, owner_identity_live |
| R19 job loop end to end | — | `integration-job-loop` runs fetch → draft → commit → code session, but never decodes the QR from the PDF and never sends a chat message; per-link specs exist for each step | — | — | `jobs_mcp.py` |
| R20 builder hardening | `builder/Dockerfile` (no USER, runs as root); `docker-compose.prod.yml` builder: no user / read_only / cap_drop / limits; `/internal/builds/*` guarded by `X-Builder-Version` only; no CSP anywhere | microsite-* 27; build lifecycle 5 (build-mark-gone, survives-builder-loss, publish-one-build, upgrade-microsite-build-lease, events-build-settled) | — | `check-microsite-imports-declared`, `builder-vendor.sh` | — |
| R21 SDK chat engine tests | `sdk/packages/react/src/chat/` 60 files | ~126 chat specs | 0 `*.test.ts` in sdk/packages; no test script | `check-chat-only-in-sdk.sh` is a lexical grep with no self-test (raw fetch + manual SSE passes) | — |
| R23 CI quality gates | **Done 2026-10-07**: workflow `quality` runs `make lint` and `make backend-test` on every push to main, with the dev box's tool versions. Its first runs found two real reds the dev box never showed (a lost NOTIFY before LISTEN in `pgstore.Listener`; a sleep-synchronised river test), both fixed in v0.1.136. Known cost: gitleaks' full-history scan takes ~12 min on the CI machine (4 s locally) | — | — | `make lint`, `make backend-test` | — |
| R24 docs reconciliation | **Mostly done 2026-10-07 (1854c273d)**: CLAUDE.md states 8 groups / 35 sections, the legacy trees as deleted, Electron as not built; `code-architecture.md` is marked a historical draft with its settled questions named. Left: `check-no-hardcoded-dev-stack.sh` still excludes the deleted `standmeet-*` dirs | — | — | `check-doc-make-targets` (make targets only) | — |

## Progress (2026-10-07, v0.1.137)

- **R2 done.** `applications.commit` is a dispatcher op (`jobsmcp.ApplicationOps`, Danger
  authority, MCP-only reach). An op result may carry `_embeds` (`facadeparity/embeds.go`); the
  MCP face turns them into embedded resources, so the PDF still arrives as a resource block.
- **R9 partly done.** keypairs, corpus trees and tags, writings tree go through admin-only
  dispatcher ops; the baseline is 37 (from 43). auth / claim / recovery (browser session
  lifecycle) and obsidian (multipart import, zip export) stay: they are not JSON-in / JSON-out.
- **R21 done.** 14 unit tests on the turn state machine (`make test-unit`, CI); the
  chat-only-in-sdk gate also catches a hand-written turn fetch, with a self-test.
- **R23 done.** CI runs every lint gate, `backend-test` and `test-unit` in parallel on main.
- **R19 done.** `integration-job-loop` runs the chain end to end: the QR decoded from the PDF's
  pixels, its URL opened as the recruiter, no /gate, the code's session, an answer.
- **R20 done in part (v0.1.138).** Builder runs as uid 1001 with cap_drop ALL (+CHOWN, SETUID,
  SETGID) and no-new-privileges; microsites carry `frame-ancestors 'self'; object-src 'none';
  base-uri 'self'`. **P0 found and fixed on the way:** the app proxied `/internal/*` to the
  backend, so every instance served its internal endpoints on the public origin (IM bot token,
  supplier invoke, builder claim) — closed, spec `internal-not-public`, verified 404 on
  sijie.xyz. Not done, by decision: a build-endpoint secret (owner code runs in the same
  container, so it would not hold).
- **R20 done (2026-10-08).** The builder box, in both compose files: `read_only` root, a 512 MB
  `/tmp` tmpfs (`exec` — esbuild's binary and rollup's native addon run from each build's copy
  of node_modules there; noexec broke every build), 1.5 GiB memory with swap equal to it, 2 CPUs,
  256 pids. Sized from a measured normal build (≈190 MiB, 41 pids). Spec
  `microsite-builder-sandbox`: owner code at prerender time tries a write to /var/tmp, a 2.5 GB
  allocation and 400 processes → refused / SIGKILL / 236 started; the next page still builds.
  Red on the old compose (the write went through). Still open, outside R20: owner code at
  prerender can write the shared `microsites_data` volume (other pages' builds).
- Found on the way and fixed: a NOTIFY lost before LISTEN (`pgstore.Listener`); a boot failure
  that hung silently on `pool.Close` (`cmd/server/main.go closePool`); `norm-outward-toolset`
  missing the nav tools; gate scripts that only worked with macOS awk and a single-entry GOPATH.

## Order

R24 first (small; a wrong map costs round trips on every task). Then the stale-but-done cleanup
(R3 leftovers, the `corpus_page.go` baseline row). Then R23, R21, R9, R15, R2, R1, R12, R13,
R19, R20.
