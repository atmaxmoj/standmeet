// facade_notify.go —— notification rules, linked IM chats and the live-transcript link: the ops
// (impl: ops), their deps (impl: usecase), and the fan-out and delivery declarations (impl:
// subscriber). Aliases only.

package owner

import (
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/ops"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Types.
type (
	NotifyDeps         = usecase.NotifyDeps
	NotifyDeliveryDeps = subscriber.NotifyDeps
	NotifyCardFacts    = subscriber.CardFacts
	NotifyCardInfo     = subscriber.CardInfo
	NotifyIMSender     = subscriber.IMSender
	NotifyCard         = entity.NotifyCard
)

// Declarations.
var (
	NotifyOps           = ops.Notify
	NotifySubscriptions = subscriber.NotifySubscriptions
	NotifyJobKinds      = subscriber.NotifyKinds
	PairIMLink          = usecase.PairIMLink
	ErrIMLinkNotFound   = entity.ErrIMLinkNotFound
	NewLiveToken        = usecase.NewLiveToken
	VerifyLiveToken     = usecase.VerifyLiveToken
)
