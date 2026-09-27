// facade_microsite_settle.go —— a microsite build settles: the settle and the preview wait (impl:
// usecase), and what follows it (impl: subscriber). Aliases only.

package owner

import (
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Types.
type (
	BuildSettleDeps   = usecase.BuildSettleDeps
	BuildReport       = usecase.BuildReport
	BuildWaitDeps     = usecase.BuildWaitDeps
	BuildSettledDeps  = subscriber.BuildSettledDeps
	AssetRefRebuilder = subscriber.AssetRefRebuilder
)

// Declarations.
var (
	SettleBuild               = usecase.SettleBuild
	AwaitBuildSettled         = usecase.AwaitBuildSettled
	MicrositeEventTypes       = usecase.MicrositeEventTypes
	BuildSettledSubscriptions = subscriber.BuildSettledSubscriptions
	ErrBadBuildStatus         = usecase.ErrBadBuildStatus
)

// BuildSettledChannel —— the NOTIFY channel a settle wakes (payload: the owner id).
const BuildSettledChannel = usecase.BuildSettledChannel
