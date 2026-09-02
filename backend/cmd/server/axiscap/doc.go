// Package axiscap — the wiring for the capability axis: reading in built-in declarations,
// registration, isolated storage, configurable settings, code-side fields and usage gates,
// per-session workspaces.
//
// A capability's **declaration** doesn't live here — it lives in
// backend/capabilities/<id>/manifest.yaml. This package only wires declarations to mechanism.
// Same shape as axisconn: two axes, the same address structure.
package axiscap
