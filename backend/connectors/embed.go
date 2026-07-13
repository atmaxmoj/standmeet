// Package connectors —— the built-in connectors shipped with the product, kept
// as their own top-level dir (sibling to the Dockerfile), not buried in
// internal/. Each is data-only (manifest + spec + binding YAML), go:embed'd into
// the binary and assembled at launch via the generic connector runtime — the
// host has zero connector-specific code (check-connector-boundary). Built-in and
// owner-uploaded connectors go through the same connector.AssembleOpenAPI /
// NewSMTPConnector; only the manifest source differs.
package connectors

import "embed"

// builtinFS —— each subdir is one built-in connector (manifest.yaml + the spec /
// binding it references). Listed explicitly so the .go files here are not embedded.
//
//go:embed google-calendar smtp bearer-api
var builtinFS embed.FS
