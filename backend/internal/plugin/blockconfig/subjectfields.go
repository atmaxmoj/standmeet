// subjectfields.go — the fields various blocks occupy on **one
// subject** (one invitation code / one role), combined into one generic face.
//
// From the owner's view that's just a few settings on "this code" or "this
// role": filled in together at creation, viewed together in the list. The
// access domain doesn't know about any block, so it exposes exactly one
// seam (which fields a block occupies, how to read them, how to write
// them); this file assembles each block's manifest declaration into the
// one implementation of that seam.
//
// This file used to be called codefields.go and only knew "code" as a
// subject. When role needed the same thing, the only difference was the
// **attachment point**: CodeScope swapped for RoleScope. So the subject became
// a field (a scope constructor), not a second copy of the code — copying it
// again would have been the same road as booker's three hand-copied files.
//
// Before that, this was implemented **per-block by hand**: booker had
// its own adapter + its own storage + its own schema fragment. A second
// block that wanted to put something on a code had to copy it all again.
// Now a block only writes its declaration — not one line gets copied.

package blockconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"

	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// SubjectBlock — one block's declaration on one kind of subject, plus its
// own storage.
type SubjectBlock struct {
	Store   *Store
	BlockID string
	Decl    []plugin.ConfigField
}

// SubjectFields — the combined face. Implements access's three-method seam
// (structurally satisfied — doesn't import access).
//
// log exists to surface write failures. This layer has no error channel
// (issuing a code / creating a role shouldn't fail just because one
// block's storage broke), so a failure must leave a trace — swallowed
// silently, the owner would only see the setting not take effect, with no way
// to find out why.
type SubjectFields struct {
	log   *slog.Logger
	byKey map[string]SubjectBlock
	// scopeOf — subject id → attachment point. This is **the entire**
	// difference between "code" and "role".
	scopeOf func(id string) Scope
	// subject — the word used in logs ("code" / "role"), only so a failure
	// reads clearly.
	subject string
	blocks  []SubjectBlock
}

// NewCodeFields — the fields various blocks occupy on **one invitation
// code**.
func NewCodeFields(log *slog.Logger, blocks []SubjectBlock) (*SubjectFields, error) {
	return newSubjectFields(log, "code", CodeScope, blocks)
}

// NewRoleFields — the fields various blocks occupy on **one role**.
func NewRoleFields(log *slog.Logger, blocks []SubjectBlock) (*SubjectFields, error) {
	return newSubjectFields(log, "role", RoleScope, blocks)
}

// NewKeyFields — the fields various blocks occupy on **one external
// API key**.
//
// The third subject. It still differs from the first two only in attachment
// point — and the reason it has to exist is F-B-11: when quota only recognized
// codes, bookings via a key went uncounted at all. **The limit has to be
// settable**, otherwise "quota is bound to the key" is only a claim.
func NewKeyFields(log *slog.Logger, blocks []SubjectBlock) (*SubjectFields, error) {
	return newSubjectFields(log, "api_key", KeyScope, blocks)
}

// newSubjectFields — combines the declarations of various blocks.
//
// Two blocks occupying the same field name → error (the assembly root
// crashes at startup on this). Two declarations fighting over one key — who
// the written value belongs to, whose read comes back — has no right answer,
// and that shouldn't surface only when the owner notices a setting didn't
// take effect.
func newSubjectFields(
	log *slog.Logger, subject string, scopeOf func(string) Scope, blocks []SubjectBlock,
) (*SubjectFields, error) {
	byKey := map[string]SubjectBlock{}
	for _, c := range blocks {
		for i := range c.Decl {
			key := c.Decl[i].Key
			if prev, taken := byKey[key]; taken {
				return nil, fmt.Errorf(
					"%w: %q claimed by both %q and %q",
					ErrFieldTaken, key, prev.BlockID, c.BlockID,
				)
			}
			byKey[key] = c
		}
	}
	return &SubjectFields{
		log: log, byKey: byKey, scopeOf: scopeOf, subject: subject, blocks: blocks,
	}, nil
}

// Fields — field name → JSON Schema fragment. The input args' schema is built
// from this.
func (f *SubjectFields) Fields() map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(f.byKey))
	for _, c := range f.blocks {
		for i := range c.Decl {
			out[c.Decl[i].Key] = schemaOf(&c.Decl[i])
		}
	}
	return out
}

// Read — the values of each block on this subject. If one block
// can't be read, that's just a few missing keys — one block's storage
// having a problem shouldn't keep the whole code / role from opening.
func (f *SubjectFields) Read(ctx context.Context, id string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, c := range f.blocks {
		values, err := c.Store.ValuesScoped(ctx, f.scopeOf(id), c.Decl)
		if err != nil {
			f.log.Warn("subject field read", "subject", f.subject,
				"block", c.BlockID, "id", id, "err", err)
			continue
		}
		maps.Copy(out, values)
	}
	return out
}

// ReadByBlock — the values on this subject, **grouped by block**:
// block id → its own keys (one JSON object).
//
// Only differs from Read by shape, but that shape matters: what gets frozen
// into a role snapshot is grouped by block, so what the host hands the
// sandbox can actually say "this is your config"; a flat table mixing every
// block together would mean the host has to know which key belongs to
// whom — which is exactly what this was built to take apart.
//
// **The name must stay distinct from Read**: both have the identical Go type
// (map[string]json.RawMessage), only the meaning of the key differs (a field
// name in one, a block id in the other). Sharing a name means grabbing
// the wrong one and the compiler saying nothing about it.
func (f *SubjectFields) ReadByBlock(
	ctx context.Context, id string,
) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, c := range f.blocks {
		encoded, ok := f.blockValues(ctx, &c, id)
		if !ok {
			continue
		}
		out[c.BlockID] = encoded
	}
	return out
}

// Write — picks each block's own fields out of the raw args and writes
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
	for _, c := range f.blocks {
		mine := pick(&c, raw)
		if len(mine) == 0 {
			continue
		}
		if err := c.Store.SetScoped(ctx, f.scopeOf(id), c.Decl, mine); err != nil {
			f.log.Warn("subject field write", "subject", f.subject,
				"block", c.BlockID, "id", id, "err", err)
		}
	}
}

// pick — the keys in the input args that belong to this block.
func pick(c *SubjectBlock, raw map[string]json.RawMessage) map[string]json.RawMessage {
	mine := map[string]json.RawMessage{}
	for i := range c.Decl {
		if v, ok := raw[c.Decl[i].Key]; ok {
			mine[c.Decl[i].Key] = v
		}
	}
	return mine
}

// blockValues — one block's values on this subject, encoded as a JSON
// object. Can't be read / can't be encoded → skip it rather than fail the
// whole config: one block's storage having a problem shouldn't keep this
// role's session from starting.
func (f *SubjectFields) blockValues(
	ctx context.Context, c *SubjectBlock, id string,
) (json.RawMessage, bool) {
	values, err := c.Store.ValuesScoped(ctx, f.scopeOf(id), c.Decl)
	if err != nil {
		f.log.Warn("subject config read", "subject", f.subject,
			"block", c.BlockID, "id", id, "err", err)
		return nil, false
	}
	encoded, merr := json.Marshal(values)
	if merr != nil {
		f.log.Warn("subject config encode", "block", c.BlockID, "id", id, "err", merr)
		return nil, false
	}
	return encoded, true
}
