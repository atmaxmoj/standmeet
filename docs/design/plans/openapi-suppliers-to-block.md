# Plan — owner-uploaded OpenAPI suppliers leave the host process

Status: 2026-10-01, plan. The last fold in `everything-is-a-block-tests.md` §"What's left" item 1.

## Facts found

- One routing switch: `assembleOpenAPISupplier` (`backend/cmd/server/blockwire/supplier_register.go`).
  Both create (`uploadedInstaller.Install`) and boot (`registerUploadedSuppliers`) go through it.
- In-host path: `AssembleOpenAPI` → `openapi.NewRuntime` → `calendarAdapter` / `mailAdapter` /
  agent-only `openapiCore` (`adapters/openapi_adapter.go`). Agent tools use `runtime.RawCall`.
  The built-in `bearer-api` block goes in-host through the same path.
- The JS engine exists twice (`infra/plugins/openapi/`, `infra/plugins/google-calendar/`); it
  reads `spec.yaml` / `binding.yaml` from its own dir at startup. `infra/plugins/openapi` is a
  template, not provisioned.
- Host side to reuse: `adapters.OpenAPIBehavior`, `blockCalendarProxy` / `oauthBlockVault`,
  `blockMailProxy`, all over `blockseam.Provider.CallVerb`, which merges the vault blob into args.

## Engine gaps (JS)

1. Spec and binding per call (from args), verbs as the union across seams.
2. Auth: the host resolves headers/query with the existing Go `authStrategy`; the engine applies
   `auth_headers` / `auth_query` and drops its own scheme sniffing.
3. Port form-urlencoded bodies and the required-field check (`runtime_body.go`).
4. `raw_call({op_id, args})` for agent tools.
5. SSRF: the sandbox has host networking. Minimum `redirect: 'error'`; dial-time private-IP refusal
   via a custom `lookup` on node `http`/`https` closes DNS rebinding.
6. `mail.verify` → `{ok:true}`, or connect fails with "tool not found".

## Steps

1. Proof first: the mail mock records the caller's `User-Agent` into Mailpit; the delivered test in
   `supplier-openapi-mail.spec.ts` asserts it is node's, not `Go-http-client`. RED today.
2. Make `infra/plugins/openapi` a runnable block (wrapper, provisioning, `backend/blocks/openapi`
   manifest); engine changes above; `node --test` cases; one engine copy (gcal requires it).
3. Go: `BearerFor` → `AuthFor`; an uploaded-supplier vault adds `spec` and `binding`.
4. Switch `assembleOpenAPISupplier` to the block path by binding seam; `Kind()` stays `openapi`.
5. Delete the in-host runtime (`adapters/openapi_adapter.go` adapters, `infra/openapi/runtime*.go`,
   binding eval) — about 1,300 lines out, 200 in.
6. Gate: every `supplier-*` spec, the gcal/booking set, `check-host-blind-to-blocks.sh`,
   `check-supplier-boundary.sh`, golangci.

## Risks

- SSRF (above) — decided: refuse private addresses at dial time in the engine.
- Every op cold-spawns a sandbox and ships the spec in the args.
- Error sentences on the mail/calendar 4xx/5xx paths may change wording.
