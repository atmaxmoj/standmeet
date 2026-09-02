// subjectfields.go — the fields various capabilities occupy on **one
// subject** (one invitation code / one role), combined into one generic face.
//
// From the owner's view that's just a few settings on "this code" or "this
// role": filled in together at creation, viewed together in the list. The
// access domain doesn't know about any capability, so it exposes exactly one
// seam (which fields a capability occupies, how to read them, how to write
// them); this file assembles each capability's manifest declaration into the
// one implementation of that seam.
//
// This file used to be called codefields.go and only knew "code" as a
// subject. When role needed the same thing, the only difference was the
// **attachment point**: CodeScope swapped for RoleScope. So the subject became
// a field (a scope constructor), not a second copy of the code — copying it
// again would have been the same road as booker's three hand-copied files.
//
// Before that, this was implemented **per-capability by hand**: booker had
// its own adapter + its own storage + its own schema fragment. A second
// capability that wanted to put something on a code had to copy it all again.
// Now a capability only writes its declaration — not one line gets copied.

package capconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// SubjectCap — one capability's declaration on one kind of subject, plus its
// own storage.
type SubjectCap struct {
	Store *Store
	CapID string
	Decl  []mcpplugin.ConfigField
}

// SubjectFields — the combined face. Implements access's three-method seam
// (structurally satisfied — doesn't import access).
//
// log exists to surface write failures. This layer has no error channel
// (issuing a code / creating a role shouldn't fail just because one
// capability's storage broke), so a failure must leave a trace — swallowed
// silently, the owner would only see the setting not take effect, with no way
// to find out why.
type SubjectFields struct {
	log   *slog.Logger
	byKey map[string]SubjectCap
	// scopeOf — subject id → attachment point. This is **the entire**
	// difference between "code" and "role".
	scopeOf func(id string) Scope
	// subject — the word used in logs ("code" / "role"), only so a failure
	// reads clearly.
	subject string
	caps    []SubjectCap
}

// NewCodeFields — the fields various capabilities occupy on **one invitation
// code**.
func NewCodeFields(log *slog.Logger, caps []SubjectCap) (*SubjectFields, error) {
	return newSubjectFields(log, "code", CodeScope, caps)
}

// NewRoleFields — the fields various capabilities occupy on **one role**.
func NewRoleFields(log *slog.Logger, caps []SubjectCap) (*SubjectFields, error) {
	return newSubjectFields(log, "role", RoleScope, caps)
}

// NewKeyFields — the fields various capabilities occupy on **one external
// API key**.
//
// The third subject. It still differs from the first two only in attachment
// point — and the reason it has to exist is F-B-11: when quota only recognized
// codes, bookings via a key went uncounted at all. **The limit has to be
// settable**, otherwise "quota is bound to the key" is only a claim.
func NewKeyFields(log *slog.Logger, caps []SubjectCap) (*SubjectFields, error) {
	return newSubjectFields(log, "api_key", KeyScope, caps)
}

// newSubjectFields — combines the declarations of various capabilities.
//
// Two capabilities occupying the same field name → error (the assembly root
// crashes at startup on this). Two declarations fighting over one key — who
// the written value belongs to, whose read comes back — has no right answer,
// and that shouldn't surface only when the owner notices a setting didn't
// take effect.
func newSubjectFields(
	log *slog.Logger, subject string, scopeOf func(string) Scope, caps []SubjectCap,
) (*SubjectFields, error) {
	byKey := map[string]SubjectCap{}
	for _, c := range caps {
		for i := range c.Decl {
			key := c.Decl[i].Key
			if prev, taken := byKey[key]; taken {
				return nil, fmt.Errorf(
					"%w: %q claimed by both %q and %q",
					ErrFieldTaken, key, prev.CapID, c.CapID)
			}
			byKey[key] = c
		}
	}
	return &SubjectFields{
		log: log, byKey: byKey, scopeOf: scopeOf, subject: subject, caps: caps,
	}, nil
}

// Fields — field name → JSON Schema fragment. The input args' schema is built
// from this.
func (f *SubjectFields) Fields() map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(f.byKey))
	for _, c := range f.caps {
		for i := range c.Decl {
			out[c.Decl[i].Key] = schemaOf(&c.Decl[i])
		}
	}
	return out
}

// Read — the values of each capability on this subject. If one capability
// can't be read, that's just a few missing keys — one capability's storage
// having a problem shouldn't keep the whole code / role from opening.
func (f *SubjectFields) Read(ctx context.Context, id string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, c := range f.caps {
		values, err := c.Store.ValuesScoped(ctx, f.scopeOf(id), c.Decl)
		if err != nil {
			f.log.Warn("subject field read", "subject", f.subject,
				"cap", c.CapID, "id", id, "err", err)
			continue
		}
		maps.Copy(out, values)
	}
	return out
}

// ReadByCapability — the values on this subject, **grouped by capability**:
// capability id → its own keys (one JSON object).
//
// Only differs from Read by shape, but that shape matters: what gets frozen
// into a role snapshot is grouped by capability, so what the host hands the
// sandbox can actually say "this is your config"; a flat table mixing every
// capability together would mean the host has to know which key belongs to
// whom — which is exactly what this was built to take apart.
//
// **The name must stay distinct from Read**: both have the identical Go type
// (map[string]json.RawMessage), only the meaning of the key differs (a field
// name in one, a capability id in the other). Sharing a name means grabbing
// the wrong one and the compiler saying nothing about it.
func (f *SubjectFields) ReadByCapability(
	ctx context.Context, id string,
) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, c := range f.caps {
		encoded, ok := f.capValues(ctx, &c, id)
		if !ok {
			continue
		}
		out[c.CapID] = encoded
	}
	return out
}

// Write — picks each capability's own fields out of the raw args and writes
// them. A key not mentioned is left untouched.
//
// A failed write doesn't block the subject itself from being created: the
// code / role is already made, settings can be edited later. But a failure
// must **be surfaced** — this layer has no error channel; swallowing it means
// the owner only sees the setting not take effect, with no way to find out
// why.
func (f *SubjectFields) Write(ctx context.Context, id string, args json.RawMessage) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(args, &raw); err != nil {
		f.log.Warn("subject field write: decode args",
			"subject", f.subject, "id", id, "err", err)
		return
	}
	for _, c := range f.caps {
		mine := pick(&c, raw)
		if len(mine) == 0 {
			continue
		}
		if err := c.Store.SetScoped(ctx, f.scopeOf(id), c.Decl, mine); err != nil {
			f.log.Warn("subject field write", "subject", f.subject,
				"cap", c.CapID, "id", id, "err", err)
		}
	}
}

// pick — the keys in the input args that belong to this capability.
func pick(c *SubjectCap, raw map[string]json.RawMessage) map[string]json.RawMessage {
	mine := map[string]json.RawMessage{}
	for i := range c.Decl {
		if v, ok := raw[c.Decl[i].Key]; ok {
			mine[c.Decl[i].Key] = v
		}
	}
	return mine
}

// capValues — one capability's values on this subject, encoded as a JSON
// object. Can't be read / can't be encoded → skip it rather than fail the
// whole config: one capability's storage having a problem shouldn't keep this
// role's session from starting.
func (f *SubjectFields) capValues(
	ctx context.Context, c *SubjectCap, id string,
) (json.RawMessage, bool) {
	values, err := c.Store.ValuesScoped(ctx, f.scopeOf(id), c.Decl)
	if err != nil {
		f.log.Warn("subject config read", "subject", f.subject,
			"cap", c.CapID, "id", id, "err", err)
		return nil, false
	}
	encoded, merr := json.Marshal(values)
	if merr != nil {
		f.log.Warn("subject config encode", "cap", c.CapID, "id", id, "err", merr)
		return nil, false
	}
	return encoded, true
}
