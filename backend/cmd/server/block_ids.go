// block_ids.go — what this build shipped, for the startup log.

package main

import (
	"slices"

	"github.com/atmaxmoj/standmeet/cmd/server/blockwire"
)

// builtinBlockIDs — the ids of the blocks compiled into this image, sorted.
//
// Sorted because a startup line is read by comparing two of them: an unsorted list
// changes order between builds for no reason and hides the one id that actually
// appeared or went away.
func builtinBlockIDs() []string {
	ms := blockwire.BuiltinManifests()
	out := make([]string, 0, len(ms))
	for i := range ms {
		out = append(out, ms[i].ID)
	}
	slices.Sort(out)
	return out
}
