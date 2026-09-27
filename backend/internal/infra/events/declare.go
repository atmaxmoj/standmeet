// declare.go — event type declarations and the glob that subscriptions match them with.

package events

import (
	"errors"
	"fmt"
	"strings"
)

// Exposure — who may receive an event type.
type Exposure int

// Exposures. The zero value is Internal: a new type cannot leave the instance by accident.
const (
	Internal Exposure = iota // in-process subscribers only
	Webhook                  // may be delivered to webhook endpoints
)

// Type — the declaration of one event type (data). Declared once by the domain that owns it.
type Type struct {
	Type        string
	Description string
	Subject     string // what the subject names, for the docs and the panel
	Exposure    Exposure
}

// Match — whether a dotted glob matches a type. "*" matches one or more trailing segments when it
// is the last segment ("corpus.*" matches corpus.note.changed), and exactly one segment elsewhere.
func Match(glob, typ string) bool {
	g, t := strings.Split(glob, "."), strings.Split(typ, ".")
	for i, seg := range g {
		if seg == "*" && i == len(g)-1 {
			return len(t) > i
		}
		if !segmentMatches(seg, t, i) {
			return false
		}
	}
	return len(g) == len(t)
}

// WebhookTypes — the types that may leave the instance.
func (b *Bus) WebhookTypes() []Type {
	out := []Type{}
	for _, t := range b.types {
		if t.Exposure == Webhook {
			out = append(out, t)
		}
	}
	return out
}

// Declared — the declaration of a type.
func (b *Bus) Declared(typ string) (Type, bool) {
	t, ok := b.types[typ]
	return t, ok
}

func (b *Bus) matchesAny(glob string) bool {
	for t := range b.types {
		if Match(glob, t) {
			return true
		}
	}
	return false
}

// segmentMatches — one non-trailing glob segment against the type's segment i.
func segmentMatches(seg string, typ []string, i int) bool {
	return i < len(typ) && (seg == "*" || seg == typ[i])
}

// declareTypes — the declarations by name; an empty or repeated name is an error.
func declareTypes(types []Type) (map[string]Type, error) {
	out := make(map[string]Type, len(types))
	for _, t := range types {
		if t.Type == "" {
			return nil, errors.New("event type: empty name")
		}
		if _, dup := out[t.Type]; dup {
			return nil, fmt.Errorf("event type %q declared twice", t.Type)
		}
		out[t.Type] = t
	}
	return out, nil
}
