// optional.go -- aliases for tri-state input args. Defined in internal/infra/facadeparity
// (a domain declaring an operation has to parse the same args, and that side must not
// depend on routing in return). The handful of resources not yet moved into a domain still
// use these names.

package dispatcher

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

type (
	// OptionalInt32 -- tri-state number: omitted / explicit null / has a value.
	OptionalInt32 = fp.OptionalInt32
	// OptionalString -- tri-state string.
	OptionalString = fp.OptionalString
	// OptionalBool -- tri-state switch.
	OptionalBool = fp.OptionalBool
	// OptionalStrings -- tri-state list.
	OptionalStrings = fp.OptionalStrings
)
