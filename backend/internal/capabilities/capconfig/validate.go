// validate.go — validates the values the owner filled in against the
// **declaration**.
//
// Validation rules come from ConfigField (type, range) instead of each
// capability hand-writing its own — booker used to hand-write it: the host's
// booking-policy handler had a min_lead_days >= 1 check, and the sandbox side
// didn't. Once declared, the rule lives in exactly one place, same as the
// default.

package capconfig

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// hhmmParts — the number of segments in 'HH:MM'.
const hhmmParts = 2

// validate — checks each field against its declaration. Returns at the first
// invalid one (the panel edits one field at a time; no need to collect all of
// them).
func validate(decl []mcpplugin.ConfigField, values map[string]json.RawMessage) error {
	byKey := map[string]*mcpplugin.ConfigField{}
	for i := range decl {
		byKey[decl[i].Key] = &decl[i]
	}
	for k, raw := range values {
		if err := validateOne(byKey[k], k, raw); err != nil {
			return err
		}
	}
	return nil
}

// validators — declared type → how to validate it. One line per type; a type
// outside the table is treated as a string.
type fieldValidator func(*mcpplugin.ConfigField, string, json.RawMessage) error

var validators = map[string]fieldValidator{
	mcpplugin.ConfigTypeInt: validateInt,
	mcpplugin.ConfigTypeTime: func(_ *mcpplugin.ConfigField, k string, r json.RawMessage) error {
		return validateTime(k, r)
	},
	mcpplugin.ConfigTypeBool: func(_ *mcpplugin.ConfigField, k string, r json.RawMessage) error {
		return validateShape(k, r, new(bool), "a boolean")
	},
	mcpplugin.ConfigTypeStringList: func(
		_ *mcpplugin.ConfigField, k string, r json.RawMessage,
	) error {
		return validateShape(k, r, &[]string{}, "an array of strings")
	},
}

func validateOne(f *mcpplugin.ConfigField, key string, raw json.RawMessage) error {
	if v, ok := validators[f.Type]; ok {
		return v(f, key, raw)
	}
	return validateShape(key, raw, new(string), "a string")
}

func validateInt(f *mcpplugin.ConfigField, key string, raw json.RawMessage) error {
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		return fmt.Errorf("%w: %q must be a whole number", ErrInvalidValue, key)
	}
	return checkBounds(f, key, n)
}

func checkBounds(f *mcpplugin.ConfigField, key string, n int) error {
	if f.Min != nil && n < *f.Min {
		return fmt.Errorf("%w: %q must be at least %d", ErrInvalidValue, key, *f.Min)
	}
	if f.Max != nil && n > *f.Max {
		return fmt.Errorf("%w: %q must be at most %d", ErrInvalidValue, key, *f.Max)
	}
	return nil
}

// validateTime — 'HH:MM'. Only this one form is accepted: both panels and the
// sandbox parse it this way.
func validateTime(key string, raw json.RawMessage) error {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return fmt.Errorf("%w: %q must be a 'HH:MM' string", ErrInvalidValue, key)
	}
	if !validHHMM(s) {
		return fmt.Errorf("%w: %q must look like 'HH:MM'", ErrInvalidValue, key)
	}
	return nil
}

func validHHMM(s string) bool {
	parts := strings.Split(s, ":")
	if len(parts) != hhmmParts {
		return false
	}
	return isTwoDigits(parts[0]) && isTwoDigits(parts[1])
}

func isTwoDigits(s string) bool {
	if len(s) != hhmmParts {
		return false
	}
	return s[0] >= '0' && s[0] <= '9' && s[1] >= '0' && s[1] <= '9'
}

// validateShape — whether the value can decode into the declared type. into
// is only used to attempt the decode, its value is never read.
//
//nolint:forbidigo // into has to be able to hold any declared type; only used to try decoding
func validateShape(key string, raw json.RawMessage, into any, want string) error {
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("%w: %q must be %s", ErrInvalidValue, key, want)
	}
	return nil
}
