// facade_mail.go —— the owner domain's mail jobs: the subscription and kinds (impl: subscriber)
// and their deps, plus the booking events whose notice they send (impl: usecase). Aliases only.

package owner

import (
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Types.
type (
	MailDeps        = subscriber.MailDeps
	BookingRecorder = usecase.BookingRecorder
	BookingRecord   = usecase.BookingRecord
)

// Declarations.
var (
	MailSubscriptions = subscriber.MailSubscriptions
	MailJobKinds      = subscriber.MailKinds
	BookingEventTypes = usecase.BookingEventTypes
)
