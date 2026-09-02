// owner_op.go — an owner-side operation a connector **declares for itself**.
//
// This came out of connectors.mail_test_send: sending a test email is **the mail connector's**
// business, not the "connector registry"'s. It used to live on the generic registry, forcing
// the registry to know about mail — a category name leaking into the generic layer.
//
// This splits it apart into the same meta-structure as the capability axis: the **declaration
// is data** (name / description / input schema / which category-contract operation it wants),
// written into the connector's own manifest; the **implementation** is wired up by the host per
// the category contract. Adding a connector-specific owner operation = adding a block to that
// connector's manifest, without touching a single line of the generic layer.

package connector

import (
	"encoding/json"
	"slices"
	"strings"
)

// OwnerOp — one owner-side operation a connector declares.
//
// Name is the externally-facing operation id (e.g. "connectors.mail_test_send"); Op is the
// **category-contract operation** it wants the host to execute (e.g. "mail.test_send"). Kept
// separate: the external naming convention isn't tied to the contract's verb.
type OwnerOp struct {
	Name        string
	Op          string
	Description string
	InputSchema json.RawMessage
}

// OpField — one field an owner operation asks the owner to fill in, derived from the declared
// input_schema.
type OpField struct {
	Key         string
	Description string
	// Type — the scalar type written in the declaration ("string" / "integer" / "number").
	// The surface picks a control based on it, and sends the value back per this type —
	// sending a string for a numeric field fails unmarshal at the op's own schema, step one.
	Type     string
	Required bool
}

// renderableFieldTypes — scalar types a control can be derived for.
//
// See the comment on Fields: never guess a control. But a **scalar isn't a guess** — integer
// has exactly one control, one conversion. Anything outside this table (nested objects /
// arrays) is a guess, and those get rejected at load time (see ValidateOpSchema).
var renderableFieldTypes = map[string]bool{"string": true, "integer": true, "number": true}

// Fields — derives a form from the declared input_schema.
//
// The declaration is written as JSON Schema (the MCP side needs it that way already); the
// surface wants a handful of input boxes. Rather than have every surface parse the schema
// itself, it's derived once alongside the declaration — the same approach as
// DeriveCredentialForm deriving a credential form from a manifest. Adding an owner operation =
// adding a block to the manifest, without touching a single line of the surface.
//
// Only recognizes top-level **scalar** properties (string / integer / number). Anything nested
// or of another type in the declaration is skipped, **never guessed into a control** — a
// guessed control fills in a wrong value, and wrong silently. A broken schema gets the same
// treatment: return empty, so that action simply isn't on the card, rather than rendering a
// form that can't be filled in correctly.
//
// This used to recognize only string, so an integer field (calendar.check's days) would be
// declared, the op could receive it, but the surface had no box for it — and nothing said a
// box was missing — F-C-17. A skip has to be **loud**: at load time, ValidateOpSchema outright
// rejects a field that can't be derived, the same discipline as "a declared but unimplemented
// op crashes on boot".
func (o OwnerOp) Fields() []OpField {
	var decl opSchemaDecl
	if err := json.Unmarshal(o.InputSchema, &decl); err != nil {
		return []OpField{}
	}
	required := make(map[string]bool, len(decl.Required))
	for _, key := range decl.Required {
		required[key] = true
	}
	return orderFields(decl.Properties, required)
}

// opSchemaDecl — the part of input_schema this layer uses.
type opSchemaDecl struct {
	Properties map[string]opPropDecl `json:"properties"`
	Required   []string              `json:"required"`
}

type opPropDecl struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}

// orderFields — required fields sort first, alphabetical within a group. A map has no order,
// but form order is something the owner actually sees: the same card looking different on
// every refresh reads like the page is flickering. So the order is fixed here.
func orderFields(props map[string]opPropDecl, required map[string]bool) []OpField {
	out := make([]OpField, 0, len(props))
	for key, prop := range props {
		if !renderableFieldTypes[prop.Type] {
			continue
		}
		out = append(out, OpField{
			Key: key, Description: prop.Description,
			Type: prop.Type, Required: required[key],
		})
	}
	slices.SortFunc(out, func(a, b OpField) int {
		if rank := requiredRank(a) - requiredRank(b); rank != 0 {
			return rank
		}
		return strings.Compare(a.Key, b.Key)
	})
	return out
}

// UnrenderableFields — the field names in the declaration that no control can be derived for
// (stable sort, good for putting into an error message).
//
// Used at load time: declaring a field the surface will never actually have is a lie, and that
// should crash on boot, not leave the owner staring at a form missing a field (F-C-17). A
// broken schema itself isn't this function's concern (the loader validates the JSON first); if
// it can't be parsed, treat it as declaring no fields.
func (o OwnerOp) UnrenderableFields() []string {
	var decl opSchemaDecl
	if err := json.Unmarshal(o.InputSchema, &decl); err != nil {
		return []string{}
	}
	out := make([]string, 0, len(decl.Properties))
	for key, prop := range decl.Properties {
		if !renderableFieldTypes[prop.Type] {
			out = append(out, key)
		}
	}
	slices.Sort(out)
	return out
}

// requiredRank — required fields sort first.
func requiredRank(f OpField) int {
	if f.Required {
		return 0
	}
	return 1
}
