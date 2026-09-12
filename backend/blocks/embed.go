// Package blocks — the blocks that ship with the product, as data.
//
// One directory per block, holding its manifest and whatever files the manifest
// names. There is no Go here beyond this file: a block is a declaration, and the
// code it points at is started at runtime, in whatever language it was written in.
//
// This package only exposes the bytes. Reading them is internal/plugin's job, and
// it reads an fs.FS — so a block that ships in the binary and a block the owner
// installed onto a data volume arrive through the identical path. That identity is
// the point: a built-in block has no standing an installed one lacks, and there is
// no second loader in which the difference could hide.
package blocks

import "embed"

//go:embed */*.yaml
var builtinFS embed.FS

// FS — the built-in blocks.
var FS = builtinFS
