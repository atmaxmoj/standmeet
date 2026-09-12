// Package blockwire — the composition root's wiring for blocks.
//
// It was two packages, axiscap and axisconn, and the note at the bottom of each said
// "same shape as the other: two axes, the same address structure". Two packages with
// the same address structure, differing in which half of one plugin model they wired,
// is the two-axis split expressed as directories — so they are one package now, and
// the sentence that described the symmetry is gone with the symmetry.
//
// A block's **declaration** does not live here. It lives in backend/blocks/<id>/
// manifest.yaml. This package only wires declarations to mechanism: reading the
// built-ins in, registering them, provisioning isolated storage, resolving a seam to
// the supplier the owner chose, and handing per-session workspaces to whatever needs
// one.
package blockwire
