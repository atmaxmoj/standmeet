// supplier_manifests.go — the built-in blocks that SUPPLY a seam, in the shape the
// adapters expect.
//
// There used to be a whole second data package for these, with its own loader and its
// own manifest struct, because a supplier and a consumer were on different axes. They
// are in one tree now, and what separates them is one field: a block with `provides`
// supplies a seam, a block without one only consumes.
//
// The translation below is the last piece of that split still standing. `adapters.
// Manifest` is the wire-level shape (kind, seam, spec, binding) and
// `plugin.Manifest` is the merged one; collapsing them is a change the adapters have to
// make, not the composition root, so this converts rather than pretending.

package blockwire

import (
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// supplierManifests — the built-in blocks that declare a seam, converted.
//
// A block with no `provides` is skipped rather than converted-and-ignored: an adapter
// built for a block that supplies nothing would sit in the table answering for a seam
// no consumer ever names.
func supplierManifests() []adapters.Manifest {
	all := BuiltinManifests()
	out := make([]adapters.Manifest, 0, len(all))
	for i := range all {
		if all[i].Provides == "" {
			continue
		}
		out = append(out, toSupplierManifest(&all[i]))
	}
	return out
}

// seamTitles — every seam a built-in supplier declares, mapped to that supplier's own
// display name.
//
// The composition root used to carry this as two constants and a switch: two row ids
// ("supplier.google-calendar", "supplier.smtp") and two names ("Google Calendar", "Mail"),
// written here, in the host. That is the host knowing which blocks ship — and it showed:
// `telegram` and `bearer-api` supply seams too, shipped in the same image, and neither
// could ever appear in the owner's table because nobody had added a third const.
//
// A block that ships in the image has no standing an installed one lacks. Its name is its
// own declaration, and this reads it.
func seamTitles() map[string]string {
	all := BuiltinManifests()
	out := make(map[string]string, len(all))
	for i := range all {
		m := &all[i]
		if m.Provides == "" {
			continue
		}
		out[m.Provides] = m.Title
	}
	return out
}

// toSupplierManifest — one block declaration → the adapter shape.
func toSupplierManifest(m *plugin.Manifest) adapters.Manifest {
	return adapters.Manifest{
		ID: m.ID, Kind: m.Transport.Kind, Seam: m.Provides,
		Protocol: m.Transport.Protocol, AuthScheme: m.Transport.AuthScheme,
		Spec: m.Transport.SpecBytes, Binding: m.Transport.BindingBytes,
		OwnerOps: declaredOwnerOps(m.OwnerTools),
	}
}

// declaredOwnerOps — the owner-facing declarations, unchanged in meaning.
//
// `owner_ops` and `owner_tools` were the same shape under two names, one per axis; the
// merged manifest kept `owner_tools`, and this is where the older spelling stops.
//
// Not to be confused with `toOwnerOps` in supplier_ops.go, which renders these for the
// admin surface. This one converts a declaration; that one presents it.
func declaredOwnerOps(ts []plugin.OwnerTool) []adapters.OwnerOp {
	out := make([]adapters.OwnerOp, 0, len(ts))
	for i := range ts {
		out = append(out, adapters.OwnerOp{
			Name: ts[i].Name, Op: ts[i].Tool,
			Description: ts[i].Description, InputSchema: []byte(ts[i].InputSchema),
		})
	}
	return out
}
