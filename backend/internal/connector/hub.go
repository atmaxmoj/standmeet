// hub.go — a consumer-agnostic named-connector registry (connector refactor · seam).
//
// Motivation (why this layer exists, and why it must stay neutral and never import MCP):
//
// connector is "the base that holds credentials" — credential decryption, OAuth refresh, and
// retries all happen inside it. **Who consumes it must not be hard-wired to MCP.** Today's
// consumer is the visitor-chat MCP capability (calls the proxy after capreg's dependency-
// resolution gate), but connector itself shouldn't know that.
//
// Future consumers may not be MCP at all. Take an **IM Gateway**: the owner is @-mentioned in
// Discord / Slack, the Gateway (eventually) wakes an agent; the agent uses that IM connector's
// credentials to **consume channel history** (read) into context, then uses the same
// credentials to **send a message** (write) back to the channel. None of that path touches MCP
// / visitor session / mcp-ui:tool — it's just "another consumer".
//
// So "resolve a connector by name + get its call handle" must live in a **neutral place**,
// usable by any consumer, and **must not import capreg (the MCP package)**. capreg's
// enabledCaps gate is only one of the consumers; the implementation phase should fold
// capreg.DepRegistry into this Hub (one base, multiple consumers, not a separate setup each
// time).
//
// Credentials never leave connector: what Hub resolves back is a "handle" (the Connector base
// surface + each connector's own capability interface), with no credential getter at all; both
// read and write are done inside the connector using decrypted credentials.

package connector

import (
	"context"
	"sync"
)

// Connector — the base surface every connector shares: a name + can answer "is this owner
// connected". Specific capabilities (calendar's InsertEvent, IM's ReadChannel/Send, SMTP's
// Send …) are given by each connector's **own interface**; a consumer resolves a Connector by
// name, then type-asserts it to whichever capability interface it needs. The base surface has
// **no credential getter**.
type Connector interface {
	Name() string
	// Kind — "openapi" | "protocol" (tells a consumer whether it runs over an HTTP spec or a
	// built-in protocol).
	Kind() string
	Connected(ctx context.Context, ownerID string) (bool, error)
}

// Verifier — a connector that can run a connection test (a protocol connector runs this on
// connect: dial + auth handshake). A connector that doesn't implement it (oauth/apiKey) needs
// no test on connect — saving it is enough to make it usable. Consumers type-assert as needed.
type Verifier interface {
	Verify(ctx context.Context, ownerID string) error
}

// Hub — a consumer-agnostic named-connector registry. Any consumer (the MCP capability gate,
// an IM Gateway, a future task orchestrator) resolves by name, gets a handle, and calls it;
// credentials / OAuth / retries all stay inside the connector, invisible to the consumer.
//
// Concurrency: Resolve is read by visitor/admin request goroutines on every category-slot
// resolution; Upsert is written by an admin goroutine whenever the owner creates/changes a
// connector at runtime (POST/PUT /connectors). An unlocked map under concurrent read+write
// makes the Go runtime fatal outright with "concurrent map read and map write". Hence the
// RWMutex: reads take RLock, creates/changes take Lock.
type Hub struct {
	conns map[string]Connector
	mu    sync.RWMutex
}

// NewHub — an empty registry.
func NewHub() *Hub { return &Hub{conns: map[string]Connector{}} }

// Register — register a named connector. Panics on a duplicate name (failing at boot is
// better than colliding at runtime).
func (h *Hub) Register(c Connector) {
	h.mu.Lock()
	defer h.mu.Unlock()
	name := c.Name()
	if _, dup := h.conns[name]; dup {
		panic("connector: duplicate connector " + name)
	}
	h.conns[name] = c
}

// Resolve — get a connector by name; not registered → (nil, false).
func (h *Hub) Resolve(name string) (Connector, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c, ok := h.conns[name]
	return c, ok
}

// Upsert — register or replace a named connector (used for runtime dynamic assembly of an
// uploaded connector / boot-time re-registration; idempotent, never panics).
func (h *Hub) Upsert(c Connector) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[c.Name()] = c
}
