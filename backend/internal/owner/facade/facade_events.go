// facade_events.go —— the owner domain's event declarations and the use cases that record them
// outside the op layer (impl: usecase). Aliases only.

package owner

import (
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

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
	// Retention —— the ephemeral clock (docs/design/job-loop-retention.md).
	RetentionPeriodicJobs = usecase.RetentionPeriodicJobs
	RetentionEventTypes   = usecase.RetentionEventTypes
	NewRetentionRepo      = repo.NewRetentionRepo
	TouchPage             = usecase.TouchPage
	SlugExpired           = usecase.SlugExpired
	NoteGasExhausted      = usecase.NoteGasExhausted
)
