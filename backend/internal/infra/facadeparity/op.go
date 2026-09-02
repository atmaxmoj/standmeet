// op.go —— an operation's complete declaration, and what it does.
//
// This vocabulary lives here rather than alongside the gate so that **a domain can state what it
// can do**: declaring an operation never requires importing any routing package. If this
// vocabulary lived in the gate instead, a domain couldn't state it there, and the declaration
// would have to move to the one place that can see both sides — which would then have to restate
// the domain's existing input/output shapes, giving the same concept a second name.

package facadeparity

import (
	"context"
	"encoding/json"
)

// Invoke —— what an operation actually does. Both input and output are opaque JSON: this
// vocabulary is protocol-agnostic, so it can name an operation without needing to know whether
// the caller comes from MCP, HTTP, or something not written yet.
type Invoke func(ctx context.Context, ownerID string, args json.RawMessage) (json.RawMessage, error)

// NoArgs —— the input schema for an operation that takes no parameters.
var NoArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// File —— one blob of bytes handed over alongside a call.
//
// Why it isn't stuffed into args: args is JSON, and base64-ing a 25MB attachment into it costs
// an extra third of the memory, plus it would grow into InputSchema — a generative facade (MCP)
// would then gain an extra parameter that facade **must never** fill in: an owner routing
// through an AI hands over an address, with the bytes living on an image host. The byte-carrying
// path belongs only to facades that can actually pick up a file.
//
// This channel didn't used to exist, and the consequence wasn't "one feature missing" — it was
// **every facade that needs to pass a file has to route around the gate**: the writings
// multipart path connects straight to the domain exactly this way (see the baseline in
// check-routes-via-dispatcher). A gate that blocks the only path just gets bypassed — what's
// missing is the mechanism, not discipline.
type File struct {
	Field       string
	Filename    string
	ContentType string
	Body        []byte
}

// filesKey —— the context key for accompanying bytes. Package-private: no other package can
// construct this key, so "who can put something in" is auditable (WithFiles is the only entry
// point).
type filesKey struct{}

// WithFiles —— attach accompanying bytes to this call.
//
// This goes through context rather than adding a parameter to Invoke so that **there is only
// one decorator chain**: the auth / quota / audit wrapping still wraps the same Invoke. Opening
// a second execution entry point would mean these policies would have to remember to wrap that
// one too — exactly the kind of "remembering" the gate exists to eliminate.
func WithFiles(ctx context.Context, files []File) context.Context {
	return context.WithValue(ctx, filesKey{}, files)
}

// FilesFrom —— which bytes this call carried. None carried means empty — empty isn't "broken",
// it means "the owner handed over an address".
func FilesFrom(ctx context.Context) []File {
	files, ok := ctx.Value(filesKey{}).([]File)
	if !ok {
		return []File{}
	}
	return files
}

// Op —— an operation's full declaration: stable id, a description for callers, input schema,
// semantic category, exposure intent (which facades owe it), and the implementation.
type Op struct {
	Invoke      Invoke
	ID          string
	Description string
	InputSchema json.RawMessage
	Reach       Reach
	Kind        Kind
}
