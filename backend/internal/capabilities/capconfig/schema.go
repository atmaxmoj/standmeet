// schema.go — translates a config field's **declaration** into its JSON Schema
// fragment in the input args.
//
// This is the only place the translation happens. Hand-writing that fragment
// separately isn't just tedious — it makes the fragment and the declaration two
// separate facts: booker's max_bookings used to be hand-written in the assembly
// root as `{"type":["integer","null"],...}`, while its type, description, and
// range were already written in the declaration — two things saying the same
// thing eventually say it differently.

package capconfig

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// jsonTypeOf — declared type → JSON Schema type. A type outside the table
// shouldn't exist (mcpplugin's constants are the full set); it falls back to
// string instead of crashing — a form that renders wrong beats an instance
// that won't start.
func jsonTypeOf(t string) string {
	switch t {
	case mcpplugin.ConfigTypeInt:
		return "integer"
	case mcpplugin.ConfigTypeBool:
		return "boolean"
	case mcpplugin.ConfigTypeStringList:
		return "array"
	default: // string / time are both strings
		return "string"
	}
}

// schemaOf — the schema fragment for one field.
//
// The type always includes "null": a field on a code is optional, and "unset"
// is different from "set to 0" (0 would be read as already exhausted).
func schemaOf(f *mcpplugin.ConfigField) json.RawMessage {
	parts := []string{
		`"type":["` + jsonTypeOf(f.Type) + `","null"]`,
		`"description":` + quote(f.Description),
	}
	if f.Type == mcpplugin.ConfigTypeStringList {
		parts = append(parts, `"items":{"type":"string"}`)
	}
	if f.Min != nil {
		parts = append(parts, `"minimum":`+strconv.Itoa(*f.Min))
	}
	if f.Max != nil {
		parts = append(parts, `"maximum":`+strconv.Itoa(*f.Max))
	}
	return json.RawMessage("{" + strings.Join(parts, ",") + "}")
}

// quote — puts description text into a JSON literal. If it can't be encoded,
// fall back to an empty string so the schema stays valid.
func quote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `""`
	}
	return string(b)
}
