// Package wire — wires up **one mechanism per file**: outbound convergence, inbound
// convergence, periodic jobs, corpus deps, search index.
//
// Each is built **once**; everywhere else projects off it. This package implements no
// mechanism and declares no capability — it only hands the running instance to each
// mechanism, then hands the mechanism to main.
package wire
