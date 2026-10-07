# P1 refactors — who participates, measured before the change

Source: the refactor ledger (R1–R25, 2026-10-06), P1 rows. Rule: before a P1 refactor
starts, list the specs, unit tests, gates and evals it touches. Then the change is planned
against that list, and the list is the regression set. Measured 2026-10-07 on main
(v0.1.135); 780 e2e specs in total.

## Already done in code (the ledger and design docs are stale)

| item | evidence | what is left |
|---|---|---|
| R3 ownercore god package | commit f35e82c04 deleted `internal/owner/ownercore` | remove `"ownercore"` from `tools/archcheck/main.go` submodules (dead entry); fix stale comments (`.go-arch-lint.yml`, `check-domain-facade-boundary.sh`, `check-core-agnostic.sh`, `mcphandle/server.go`, `blockwire/service.go`, `paritymanifest/*`); mark the "Owed" section in `backend-domain-modules.md` done |
| R4 booker policy dedup | commits 7f02bccc1, 8c405eafd, f614c08f3, a1d2f0876 deleted every host copy and the Go booker | one copy left: `infra/plugins/booker/booker-mcp.js`; inside it `doCancelByID` repeats `deleteBooking` |
| R13 everything-is-a-block (part) | CalDAV, Telegram and SMTP are blocks; `switch m.Protocol` is gone; the host-blind baseline is empty | persistence is still a host op (`plugin/blockstore`); two `.Register(` calls sit outside the door (`boot_deps.go`, `boot_wireup_microsites.go`); the supplier layer (`supplier_register.go`) remains |
| R15 bundle ACL (part) | the additive bundle gate exists (`registry/bundle_gate.go`), with migrations | see R15 below |

## Open items

| item | footprint | e2e specs | unit tests | gates | evals |
|---|---|---|---|---|---|
| R1 jobs / resume as blocks | `owner/jobs/` 84 files, ~12.6k lines; 4 fibers (jobs, resume, applications, assistant), 19 tools | 65 (job-fetch-*, resume-*, draft-*, composer-*, applications-*, integration-job-loop, norm-outward-*) | 10 in jobs/ + `blockload/resume_read_test.go` | 12 arch-lint components (36 mayDependOn lines); `tools/archcheck` submodule `jobs`; `check-host-blind-to-blocks`, `check-core-seals-only`; planned `check-no-core-capability-fibers` does not exist | `jobs_mcp.py` |
| R2 applications.commit as a dispatcher op | `jobsmcp/fiber_applications.go`, jobsuc applications usecase | 11 (applications-commit*, application-*, integration-job-loop, norm-outward-toolset, resume-draft-preview, resume-tool-gated-to-applications, resume-pdf-render) | `applications_commit_test.go`, `schema_valid_test.go` | `check-routes-via-dispatcher`, facadeparity Conform (the new op must declare a danger class: authority) | `jobs_mcp.py` |
| R9 routes/admin direct imports | 10 admin files import owner/corpus facades, ~68 call sites | auth/claim via fixtures in ~660 specs; obsidian 49; export/import/recovery 22; tree 5; keypairs 3 | `deps_wired_test.go`; dispatcher 3 | `check-routes-via-dispatcher` baseline (46 rows, 11 admin; `corpus_page.go` row no longer offends — delete it); `adminroutes.mayDependOn` in arch-lint | none |
| R12 connector declarations as data | `openapi/binding.go` SeamContractOps; switches in `supplier_register.go`, `credform.go`; typed proxies in `adapters/seam_*.go` | 133 mention supplier (67 `supplier-*`); core: supplier-provider-agnostic, supplier-happy-matrix | adapters 4, blockwire 5, credform 1, blockseam 1 | `check-supplier-boundary`, `check-blocks-declare-in-data` | booker/candidate/canned-host evals; dsh-acceptance mail-sender, smtp, google-calendar, caldav |
| R13 remainder | `plugin/blockstore` 753 lines; supplier layer | blockstore 15; CalDAV 11; Telegram 6 | blockstore 2, credmgr 1, nativekey 2 | `check-register-via-door`, `check-host-blind-to-blocks`, `check-hostops-via-desk`, `check-native-key-confined`, `check-supplier-boundary` | dsh-acceptance caldav, koishi |
| R15 bundle ACL additive | subtractive side live: `code_acl.go`, `codes_acl.go`, `api_keys_acl.go`, `visitor_role_snapshot.go`, `code_block_denials`, denial MCP tools; `block_connections` not moved to credential-manager storage | subtractive family 8 (acl-block-matrix, acl-skill-matrix, acl-corner-errors, acl-freeze-isolation, acl-frozen-product, acl-global-master, iam-role-raw-deny, visitor-chat-permissions-deny) — to be rewritten on purpose; additive 6 | registry 5, access/usecase 5, conversation/usecase 6 | no specific gate | experiment, ask, blocks.py, owner_identity_live |
| R19 job loop end to end | — | `integration-job-loop` runs fetch → draft → commit → code session, but never decodes the QR from the PDF and never sends a chat message; per-link specs exist for each step | — | — | `jobs_mcp.py` |
| R20 builder hardening | `builder/Dockerfile` (no USER, runs as root); `docker-compose.prod.yml` builder: no user / read_only / cap_drop / limits; `/internal/builds/*` guarded by `X-Builder-Version` only; no CSP anywhere | microsite-* 27; build lifecycle 5 (build-mark-gone, survives-builder-loss, publish-one-build, upgrade-microsite-build-lease, events-build-settled) | — | `check-microsite-imports-declared`, `builder-vendor.sh` | — |
| R21 SDK chat engine tests | `sdk/packages/react/src/chat/` 60 files | ~126 chat specs | 0 `*.test.ts` in sdk/packages; no test script | `check-chat-only-in-sdk.sh` is a lexical grep with no self-test (raw fetch + manual SSE passes) | — |
| R23 CI quality gates | `.circleci/config.yml`: one tag-only workflow (build-push ×6 images, npm-publish) | — | — | `make lint` chains 9 targets, 5–11 min locally; `backend-test` needs the ut-db Postgres | — |
| R24 docs reconciliation | CLAUDE.md: says 6 admin sections (nav has 8 groups, 35 sections), names legacy dirs that no longer exist, describes Electron and the old tool list; `code-architecture.md` "Draft" since 2026-05-16, 2 of 5 open questions settled by building | — | — | `check-doc-make-targets` (make targets only); `check-no-hardcoded-dev-stack.sh` references the deleted legacy dirs | — |

## Order

R24 first (small; a wrong map costs round trips on every task). Then the stale-but-done cleanup
(R3 leftovers, the `corpus_page.go` baseline row). Then R23, R21, R9, R15, R2, R1, R12, R13,
R19, R20.
