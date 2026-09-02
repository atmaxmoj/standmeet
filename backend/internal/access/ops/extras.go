// extras.go — config that **other capabilities** self-manage on a subject (a code / a role).
//
// This started from max_bookings: it's a per-code quota booker stores itself (the kernel's
// access_code table has no such column), but in the owner's eyes it's just a number on "this
// code" — filled in when issuing the code, seen together in the list. The role side's first
// one was notify_owner — it used to **really** be a column on the kernel's roles table.
//
// access doesn't know booker, doesn't even know what the field is called: what it gets is a
// seam — at declaration time it asks "which fields do you want to occupy in this subject's
// payload", outbound it asks "what are the values of your fields on this subject", inbound it
// hands over the whole raw input and lets the capability pick its own fields. The assembly
// root wires up every capability that declares this kind of config.
//
// The same seam is used twice (once for codes, once for roles). The subject is a **parameter**,
// not two separate interfaces — this is the other half of the same point capconfig makes about
// "what it's mounted on is a parameter".
//
// Both read and write are best-effort: that storage belongs to another capability. Failing to
// read shouldn't stop the whole code / role from opening, and failing to write shouldn't block
// creation — the thing is already built, its config can be set later.

package ops

import (
	"context"
	"encoding/json"
	"maps"
)

// SubjectExtras — the fields a capability occupies on a subject (a code / a role).
type SubjectExtras interface {
	// Fields — field name → that field's JSON Schema fragment. Called once at declaration
	// time.
	Fields() map[string]json.RawMessage
	// Read — the values of those fields on this subject. Missing keys if they can't be read.
	Read(ctx context.Context, id string) map[string]json.RawMessage
	// Write — pick your own fields out of the raw input and write them. Untouched if not
	// mentioned.
	Write(ctx context.Context, id string, args json.RawMessage)
}

// CodeExtras — the fields a capability occupies on a code (an alias of SubjectExtras). Named
// separately so deps make it clear what it's mounted on; the type is the same, so this doesn't
// grow a second mechanism.
type CodeExtras = SubjectExtras

// RoleExtras — the fields a capability occupies on a role (same as above, different mount
// point).
type RoleExtras = SubjectExtras

// KeyExtras — the fields a capability occupies on an outward-facing API key (same as above,
// a third mount point).
//
// It exists because of F-B-11: "how many times this subject may be booked at most" used to
// only be mountable on a code, so the outward-key path never gated it at all. The cap has to
// be mountable there too, and settable there too.
type KeyExtras = SubjectExtras

// noExtras — the "nothing" for when no capability has declared config on this kind of subject.
type noExtras struct{}

func (noExtras) Fields() map[string]json.RawMessage {
	return map[string]json.RawMessage{}
}

func (noExtras) Read(_ context.Context, _ string) map[string]json.RawMessage {
	return map[string]json.RawMessage{}
}

func (noExtras) Write(_ context.Context, _ string, _ json.RawMessage) {}

// is wired up
//
//nolint:ireturn // this seam is an interface by design: gives a "nothing" when no capability
func extrasOr(e SubjectExtras) SubjectExtras {
	if e == nil {
		return noExtras{}
	}
	return e
}

// withExtraFields — merge the fields a capability declared into a schema's properties.
func withExtraFields(base json.RawMessage, fields map[string]json.RawMessage) json.RawMessage {
	if len(fields) == 0 {
		return base
	}
	var schema map[string]json.RawMessage
	if err := json.Unmarshal(base, &schema); err != nil {
		return base
	}
	merged, err := json.Marshal(mergedProperties(schema["properties"], fields))
	if err != nil {
		return base
	}
	schema["properties"] = merged
	return remarshal(schema, base)
}

// mergedProperties — the original properties + the ones a capability adds.
func mergedProperties(
	base json.RawMessage, fields map[string]json.RawMessage,
) map[string]json.RawMessage {
	props := map[string]json.RawMessage{}
	if err := json.Unmarshal(base, &props); err != nil {
		props = map[string]json.RawMessage{}
	}
	maps.Copy(props, fields)
	return props
}

// withExtraValues — merge a capability's field values into an already-serialized payload.
func withExtraValues(payload json.RawMessage, values map[string]json.RawMessage) json.RawMessage {
	if len(values) == 0 {
		return payload
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(payload, &obj); err != nil {
		return payload
	}
	maps.Copy(obj, values)
	return remarshal(obj, payload)
}

// remarshal — falls back to the original on a re-encode failure: a few extra fields aren't
// worth failing the whole operation.
func remarshal(obj map[string]json.RawMessage, fallback json.RawMessage) json.RawMessage {
	out, err := json.Marshal(obj)
	if err != nil {
		return fallback
	}
	return out
}
