// Package main —— the composition root for the standmeet backend. It **only does
// assembly**: wires together things declared elsewhere, implements no business logic
// itself. The process entry point is main.go.
//
// # The directory layout is the charter
//
// Once this directory grew past thirty-odd files there was no rule left to follow:
// the filename alone couldn't answer "what does this file do here". It's now split
// into packages, each summed up in one sentence:
//
//	deps/      Everything that's running (connection pools, each domain's repos, the
//	           block registry, the two convergence points). **Data only, no
//	           assembly** — it's a leaf, nothing imports it, so every package
//	           below can receive the same reference.
//	port/      The composition root **implementing a narrow port a domain declares**:
//	           a domain says "I need this one thing", and this package satisfies it
//	           with something concrete on hand. The domain therefore never has to
//	           know about owner / inference / redis in return.
//	blockwire/ Blocks and the seams they use: reading in builtin declarations,
//	           registration, isolated storage, configurable options, on-code fields
//	           and usage gates, workspaces; plus builtin and owner-uploaded
//	           suppliers, their seam operations and the seam dependency registry.
//	config/    Environment-derived settings, parsed once.
//	wire/      Wiring together **one mechanism** per file: outbound convergence,
//	           inbound convergence, periodic jobs, corpus dependencies, search index.
//
// The root directory itself keeps only the boot sequence: main.go (entry point),
// boot_* (dependency assembly / HTTP / logging / overall wiring), cmd_*
// (CLI subcommands).
//
// # Dependencies are one-directional
//
//	deps ← port ← blockwire ← wire ← main
//
// This isn't a convention, it's the compiler's job: a cycle between packages fails to
// build. When these were all flattened into one package, any section could reach any
// other section directly, and "who's supposed to know about whom" was only kept
// straight by memory.
//
// # Declarations live with the block, not here
//
// A block's **declaration** does not live here: it lives in
// backend/blocks/<id>/manifest.yaml. This package only wires declarations to the
// mechanism. Declarations living in the composition root was how things looked before
// this round — a block's own knowledge grew wherever it was assembled, so adding a
// block meant editing assembly.
//
// # Two convergence points
//
//	outbound  internal/routes/dispatcher —— where faces draw blocks from
//	inbound   internal/routes/hostdesk   —— where a sandboxed block reaches back
//	          to ask the host for something
//
// Build exactly **one** of each; everywhere else projects from it. A convergence point
// only exists on the premise that there is no other path; so this directory is not
// allowed to hang its own verbs, open its own socket, or start its own ticker — all
// three are watched by a gate (check-routes-via-dispatcher / check-hostops-via-desk /
// check-periodic-via-scheduler).
package main
