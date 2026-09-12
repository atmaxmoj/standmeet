// Package plugin is the block substrate: what a block declares, and how a seam is resolved.
//
// The vocabulary is `docs/design/plugin/block-model.md`'s:
//
//	block     the atomic unit of code — one manifest under backend/blocks/<id>/
//	fiber     one loaded instance of a block at runtime (see plugin/registry)
//	seam      a swappable capability: a name, whoever provides it, whoever consumes it
//	bundle    a distribution unit — what one access code carries (see plugin/assembly)
//
// This package holds the declaration side: the manifest shape, the loader that reads one off
// disk, and the resolver that answers "which block supplies this seam". Both halves of a seam
// spell it the same way, in data — `provides` on one side, `requires` on the other — which is
// what lets a CalDAV block replace a Google one without any consumer changing.
//
// It knows no domain. Turning a declaration into a running fiber is plugin/mount's; loading one
// that needs domain data is routes/blockload's.
package plugin
