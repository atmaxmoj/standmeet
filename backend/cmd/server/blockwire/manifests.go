// manifests.go — where the declarations for the built-in blocks come from.
//
// **The declarations themselves do not live here** — they live in
// backend/blocks/<id>/manifest.yaml, one directory per block, and this file is only the
// assembly root's port for pulling them in.
//
// There used to be two of these, one per axis, reading two separate trees into two
// different structs. One tree and one struct now: a block that supplies a seam and a
// block that consumes one are the same kind of thing, and the loader stopped being able
// to tell them apart when `category` became `provides`.
//
// Before that it was five Go literals — a block's identity, which host ops it
// calls, which field it occupies on a code, its config defaults — 200-odd lines of a
// block's own knowledge written at the assembly site. The assembly root should only
// assemble.

package blockwire

import (
	"slices"

	"github.com/atmaxmoj/standmeet/blocks"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// BuiltinManifests — the built-in blocks' declarations, read in at one place.
//
// Registration, facade-parity reconciliation, inbound-convergence dispatch, code-side
// fields and usage gates all read this same copy; nothing ever checks against a stale
// duplicate.
func BuiltinManifests() []plugin.Manifest {
	return builtins
}

// BlockManifests — the built-in blocks that offer TOOLS, as opposed to the ones
// that supply a seam.
//
// The mirror of `supplierManifests()`, and the second half of one rule: `shape` says who
// a block faces (a visitor, the owner, or both), and a block that faces nobody offers no
// tools. `google-calendar` and `smtp` are things `calendar.book` and `mail.send` are
// pointed at; they face nobody, and they have no `shape` to declare.
//
// Two trees kept this straight for free — the two pre-merge trees were read by different
// loaders into different structs. One tree costs one filter, and forgetting it put every
// supplier into the visitor's block map with an empty shape.
func BlockManifests() []plugin.Manifest {
	out := make([]plugin.Manifest, 0, len(builtins))
	for i := range builtins {
		if builtins[i].Shape == "" {
			continue
		}
		out = append(out, builtins[i])
	}
	return out
}

// builtins — read once per process.
var builtins = mustLoadBuiltins()

// mustLoadBuiltins — read them, or refuse to come up.
//
// Failing to read or parse is a **panic**. The built-in declarations are an asset
// shipped inside the image, not a runtime condition: a broken manifest means this build
// is broken, and booting with half a block set would only move the problem onto
// visitors, who cannot tell a missing tool from a tool that was never offered.
func mustLoadBuiltins() []plugin.Manifest {
	out, err := plugin.Load(blocks.FS)
	if err != nil {
		panic(err)
	}
	return out
}

// APICandidateBlocks — the blocks an owner may OPEN to the api facade: those declaring at
// least one visitor tool the api renderer actually serves, sorted.
//
// This was a two-element string literal inside paritymanifest — the tool-grain list was
// derived there and the block-grain list beside it was typed by hand, so the two could
// disagree and nothing would notice. It also put two block ids inside the host, which is
// the host knowing which blocks ship.
//
// A block declares its tools; paritymanifest declares which tools the api renders; the
// intersection is the answer, and neither side holds a copy of the other's list.
func APICandidateBlocks() []string {
	renderable := paritymanifest.APIRenderableTools()
	ms := BlockManifests()
	out := make([]string, 0, len(ms))
	for i := range ms {
		m := &ms[i]
		if slices.ContainsFunc(plugin.VisitorToolNames(m.VisitorTools), func(t string) bool {
			return slices.Contains(renderable, t)
		}) {
			out = append(out, m.ID)
		}
	}
	slices.Sort(out)
	return out
}
