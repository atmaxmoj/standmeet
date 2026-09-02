// Package capabilities — the built-in capability **declarations** shipped with the
// product, its own top-level directory (a sibling of Dockerfile), not buried under
// internal/. Same shape as backend/connectors/: two plugin axes, the same address
// structure.
//
// Each subdirectory is one capability, data only (manifest.yaml), go:embed'd into
// the binary, assembled at startup through the shared mcpplugin loading path — the
// host imports no plugin code; the contract is only this manifest plus the runtime
// MCP protocol. Built-in and third-party capabilities take **exactly the same**
// sandbox_stdio path; only the manifest's source differs.
//
// These declarations used to be Go literals in the composition root: a
// capability's identity, which host ops it ordered, which field it occupies in
// code — all of it lived in the composition root, which should only assemble.
package capabilities

import "embed"

// builtinFS — one built-in capability per subdirectory. Listed one by one so the
// .go files in this directory don't also get embedded.
//
//go:embed ask_visitor calendar.book corpus.retrieval mail.send summarize_conversation
var builtinFS embed.FS
