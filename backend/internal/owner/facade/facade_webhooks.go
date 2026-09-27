// facade_webhooks.go —— webhook endpoints: the ops (impl: ops), their deps (impl: usecase), and
// the fan-out and delivery declarations (impl: subscriber). Aliases only.

package owner

import (
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/ops"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Types.
type (
	WebhooksDeps        = usecase.WebhooksDeps
	WebhookDeliveryDeps = subscriber.Deps
	WebhookSecretOpener = subscriber.SecretOpener
	WebhookEmbedAdmits  = subscriber.EmbedAdmits
	SealedSecret        = repo.SealedSecret
)

// Declarations.
var (
	EmbedHooks             = usecase.EmbedHooks
	SetEmbedHook           = usecase.SetEmbedHook
	ErrWebhookInput        = entity.ErrWebhookInput
	WebhookOps             = ops.Webhooks
	WebhookEventTypes      = subscriber.EventTypes
	WebhookSubscriptions   = subscriber.Subscriptions
	WebhookJobKinds        = subscriber.Kinds
	NewWebhookDeliveryDeps = subscriber.NewDeps
)
