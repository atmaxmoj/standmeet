// Package blockadmin orchestrates what an owner does to a supplier: save credentials, connect,
// finish an OAuth callback, activate, disconnect, validate an uploaded spec.
//
// It is deliberately NOT a face. Route handlers run under a cyclo ≤3 budget and may only declare
// and delegate; this is the business logic they delegate to, and it runs under the ordinary
// business budget. It lived under `internal/routes/` for a while after a rename, which put a
// service under a rule written for controllers — the gate caught it, and it moved here.
package blockadmin
