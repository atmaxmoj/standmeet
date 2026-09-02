// config_field.go —— a plugin's **declared configurable fields**.
//
// Its own file: manifest.go is already full of the transport/sandbox/ACL kind
// of declaration, and config is a third kind — mixing them in would bury the
// question of "what kinds of things can a plugin declare".

package mcpplugin

// ConfigField —— one **configurable field** of a plugin, also pure declared data.
//
// Why this class had to exist: before this, a capability wanting an "owner-tunable
// setting" had **no path** for it — a capability could declare which connector it
// needs (Requires), could declare which owner tools it exposes (OwnerTools), but
// could not declare "what configurable fields I have". So booker's booking policy
// had to be hand-written wholesale on the host: entity type, defaults, capstore
// read/write, admin route, form, plus an owner MCP tool. The hand-written copy was
// bound to drift, and it already had (host said work-until-18:00 buffer-15min,
// sandbox said 17:00 buffer-0).
//
// This fills **the same hole** OwnerTools did: sandboxed capabilities back then had
// no way to expose tools to the owner, so the owner side was forced to rewrite it on
// the host. A mechanism gap breeds duplication, and duplication is bound to drift.
//
// With this filled in, the host only does three **generic** things: render a form
// from the declaration, save what the owner fills in into this capability's own
// isolated storage, and fall back to the declared default on read. The host doesn't
// know a word like "working_hours".
//
// **Defaults and validation rules live in exactly one place.** The capability's
// implementation shouldn't have its own defaultXxx(), and the panel shouldn't
// hand-write "this number must be >= 1" a second time either.
type ConfigField struct {
	// Min / Max —— value range for a numeric field (nil = unbounded). Write it
	// directly in the declaration as new(1). Validation is part of the declaration
	// too: skip it here and it can only be hand-written again in each capability's
	// own handler — which is exactly how booker used to be (the host's
	// booking-policy handler hand-wrote min_lead_days >= 1, the sandbox side didn't).
	Min *int
	Max *int
	// Key —— the stable key used for storing and reading back (the capability's
	// implementation reads by this key).
	Key string
	// Label —— the name shown on the panel.
	Label string
	// Type —— what the panel renders by: string / int / bool / time / string_list.
	Type string
	// Description —— one line of explanation on the panel.
	Description string
	// Default —— the default value as a JSON literal (`"18:00"` / `2` /
	// `["mon","tue"]`). What's read back when the owner never set it.
	Default string
}

// Config field types —— the panel picks a widget by this, the host validates by
// this; capabilities must not invent types outside this table.
const (
	ConfigTypeString     = "string"
	ConfigTypeInt        = "int"
	ConfigTypeBool       = "bool"
	ConfigTypeTime       = "time"
	ConfigTypeStringList = "string_list"
)
