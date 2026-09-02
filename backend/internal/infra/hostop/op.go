// Package hostop — the vocabulary the host exposes to sandboxed capabilities (inbound direction).
//
// Outbound has facadeparity: a domain declares what it does, a single convergence point
// collects it, and facades project it. Inbound is its mirror: a capability inside the sandbox
// has no network, so it can only call back to the host over a unix socket to ask for things
// (read the corpus, send mail, store its own data). This vocabulary lets **a domain say for
// itself** which operations it exposes, without the domain importing routing or importing
// the capability axis.
//
// Why not reuse facadeparity.Op: outbound's identity is the owner; inbound's identity is
// **the session** (owner + conversation, planted by the host on the tool call's _meta and
// passed through unchanged by the plugin). Mixing the two identities into one type leaves
// the reader unable to tell who a given op is actually acting on behalf of.
package hostop

import (
	"context"
	"encoding/json"
	"path/filepath"
)

// SocketDir / SocketPath — where a capability's socket lands, derived from an **id the
// host trusts**.
//
// The path isn't written into the manifest: the declaration says "which operations I want,"
// not "which file to mount for me." The side that opens the socket (the convergence point)
// and the side that binds it into the sandbox (the loader) both compute it from the same
// rule, so the two sides never end up with two different paths.
const SocketDir = "/run/standmeet"

// SocketPath — derives the socket path for a given capability.
func SocketPath(pluginID string) string {
	return filepath.Join(SocketDir, pluginID+".sock")
}

// Invoke — what a host op actually does. Both the request and response are opaque JSON:
// identity lives in the request body, and this vocabulary is transport-agnostic.
type Invoke func(ctx context.Context, req json.RawMessage) (json.RawMessage, error)

// Op — one thing the host exposes to the sandbox.
//
// Name is an entry from the fixed vocabulary (e.g. "conversation.read"). A capability orders
// by name in its own manifest; ordering a name that isn't in the vocabulary blows up at
// startup, not later when the owner actually clicks it.
type Op struct {
	Invoke      Invoke
	Name        string
	Description string
}
