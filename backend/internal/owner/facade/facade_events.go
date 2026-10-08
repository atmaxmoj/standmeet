// facade_events.go —— the owner domain's event declarations and the use cases that record them
// outside the op layer (impl: usecase). Aliases only.

package owner

import "github.com/atmaxmoj/standmeet/internal/owner/usecase"

// Types.
type (
	VaultImports = usecase.VaultImports
)

// Declarations.
var (
	OwnerEventTypes       = usecase.OwnerEventTypes
	GasRefillPeriodicJobs = usecase.GasRefillPeriodicJobs
	// MicrositeTrashPeriodicJobs —— the daily purge of pages deleted more than 90 days ago.
	MicrositeTrashPeriodicJobs = usecase.MicrositeTrashPeriodicJobs
	NoteGasExhausted           = usecase.NoteGasExhausted
)
