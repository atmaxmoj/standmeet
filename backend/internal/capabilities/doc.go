// Package capabilities — the mechanism axis for loading/dispatching MCP **capabilities**
// for standmeet's own agent (the visitor agent) (this aligns with the capability axis in the
// backend-domain-modules.md class diagram: declaration → implementation → instance → one
// opaque door).
//
// What lives here is the mechanism for the "capability" axis, in these subpackages:
//   - capreg     — the capability **declaration** registry (boot plugins + owner-registered
//     MCP / installed skills).
//   - capsocket  — the host-side callback socket: the narrow port an offline sandboxed
//     capability binds through to call back into a backend op.
//   - mcpclient  — the transport we use as a **client** dialing an **external**
//     owner-registered MCP server.
//   - mcpplugin  — installed-plugin manifest parsing + discovery sources.
//   - mcputil    — the shared marshaller for capability tool return values.
//   - capstore   — per-plugin isolated JSONB storage (one schema per capability/connector).
//
// Explicit boundaries (don't misplace things here):
//   - **This is not connector.** connector is a different axis — owner-held-credential
//     external integrations (gcal/smtp/…) that decrypt credentials to call an external
//     service on the owner's behalf. Credentials never leave connector. capabilities only
//     looks things up by name through connector's opaque door (connector-deps); it never
//     touches a token itself.
//   - **This is not the entry point for an external agent to access standmeet.** That's the
//     MCP **server** facade in routes/mcphandle (which aggregates owner tools into one
//     outward-facing endpoint). capabilities runs the opposite direction: our own agent
//     loading and calling capabilities outward/into the sandbox.
//
// The **implementation** of a capability does not live here: sandboxed leaves
// (booker/retrieval/summarize/…) live in the top-level mcp-servers/; owner-side trusted
// capabilities (ownercore/jobs) belong to the owner module. This package holds only the
// axis's mechanism.
//
// Hard rule: capabilities **must never contain any concrete MCP capability**. Every concrete
// capability is externalized without exception (either a sandboxed process under
// mcp-servers/, or an owner-side plugin); this package holds only **generic loading
// infrastructure** — registry / transport / socket / storage / manifest. Looking at this
// package alone, you should not be able to tell that any externalized capability
// (booker/retrieval/summarize/mail-sender/ask-visitor/…) exists. check-core-agnostic
// structurally enforces this as a ratchet (a hit = red).
// (ghost is exempt from this — it's a core conversation feature, not an externalized MCP
// capability.)
package capabilities
