// optional.go —— for input fields where "not mentioned" and "explicitly set to empty" are two
// different things.
//
// The origin is quotas: for the same op, the admin panel sends every field on every call, and
// null means "unlimited"; on the MCP side an omitted field means "leave this alone". JSON
// already distinguishes "field absent" from "field is null", but Go's *T can't — so previously
// the two facades each wrote their own rule (panel blind-writes everything, MCP reads back first
// and merges), two rule sets for the same thing, and the blind-write path would silently wipe
// out a field it never sent.
//
// Kept here alongside Op / RequireArgs: the package that declares an operation is the same
// package that parses its args, so a domain using it doesn't need to know about routing.

package facadeparity

import "encoding/json"

// OptionalInt32 —— three states: not mentioned (Set=false, keep the original value) / explicit
// null (Set=true, Value=nil, clear to "unlimited") / a number (set the value).
type OptionalInt32 struct {
	Value *int32
	Set   bool
}

// UnmarshalJSON —— Set=true whenever the field appeared (the value may be null); when the field
// never appeared this method is never called at all, so the zero value Set=false means
// "not mentioned".
func (o *OptionalInt32) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var v int32
	if err := json.Unmarshal(b, &v); err != nil {
		return BadInput("value must be a number or null")
	}
	o.Value = &v
	return nil
}

// Or —— use current to fill in when not mentioned.
func (o *OptionalInt32) Or(current *int32) *int32 {
	if o.Set {
		return o.Value
	}
	return current
}

// OptionalString / OptionalBool / OptionalStrings —— the same idea, for three more field types.
// When the backing SQL rewrites the whole row (UPDATE ... SET / upsert), "not mentioned" must
// read back the original value, or omitting a field is the same as clearing it — that's exactly
// how seo's site_title got wiped out via the MCP path.
type OptionalString struct {
	Value string
	Set   bool
}

// UnmarshalJSON —— appearing at all means Set; null is treated as an empty string (this kind of
// field has no distinction between "empty" and "absent").
func (o *OptionalString) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = ""
		return nil
	}
	if err := json.Unmarshal(b, &o.Value); err != nil {
		return BadInput("value must be a string or null")
	}
	return nil
}

// Or —— use current to fill in when not mentioned.
func (o *OptionalString) Or(current string) string {
	if o.Set {
		return o.Value
	}
	return current
}

// OptionalBool —— a three-state switch.
type OptionalBool struct {
	Value bool
	Set   bool
}

// UnmarshalJSON —— appearing at all means Set; null is treated as false.
func (o *OptionalBool) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = false
		return nil
	}
	if err := json.Unmarshal(b, &o.Value); err != nil {
		return BadInput("value must be true, false or null")
	}
	return nil
}

// Or —— use current to fill in when not mentioned.
func (o *OptionalBool) Or(current bool) bool {
	if o.Set {
		return o.Value
	}
	return current
}

// OptionalStrings —— a three-state list. Both null and [] mean "clear", kept distinct from
// "not mentioned".
type OptionalStrings struct {
	Value []string
	Set   bool
}

// UnmarshalJSON —— appearing at all means Set; null is treated as an empty list.
func (o *OptionalStrings) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = []string{}
		return nil
	}
	if err := json.Unmarshal(b, &o.Value); err != nil {
		return BadInput("value must be an array of strings or null")
	}
	return nil
}

// Or —— use current to fill in when not mentioned.
func (o *OptionalStrings) Or(current []string) []string {
	if o.Set {
		return o.Value
	}
	return current
}
