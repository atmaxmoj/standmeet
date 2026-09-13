// seam_providers.go —— the door for SEAM dependency providers.
//
// The fiber registry has its door (RegisterOwnerFibers / RegisterVisitorSkills above); the SEAM
// dependency registry (registry.DepRegistry — "is this seam supplied for this owner") had none: the
// composition root reached into it directly (blockwire's registerBaseSeams / registerSeams called
// depReg.Register). That was the forbidden second path — two answers to "where is a provider
// registered?". This is the one answer for seams too: a domain ASSEMBLES its providers (from block
// manifests + supplier connectivity — construction, which stays in the composition root) and hands
// them here; the door performs the registration. One reference chain, facade→core
// (everything-is-a-block.md rule 2).

package blockload

import "github.com/atmaxmoj/standmeet/internal/plugin/registry"

// RegisterSeamProviders —— register assembled seam providers into the DepRegistry via the one door.
// A duplicate seam panics via Register as a boot-time backstop (the caller dedupes per seam
// upstream, which stays load-bearing).
func RegisterSeamProviders(depReg *registry.DepRegistry, providers []registry.DepProvider) {
	for _, p := range providers {
		depReg.Register(p)
	}
}
