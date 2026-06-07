// visitor_data_sources_ports.go —— the single-method visitor data-source ports
// (owner read + conversation read). Split from visitor_data_sources.go to stay
// under the per-file public-struct cap; same F.2 purpose — narrow seams the eval
// facade injects fixtures into while prod's postgres repos satisfy them as-is.

package usecases

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// OwnerGetter —— the owner reads the visitor path needs: GetByID (calendar.book
// reads owner.ProfileTimezone) + FirstHandle/GetByHandle (public/byoai tier
// resolves the sole owner). VisitorDeps.Owners is this narrow port so the eval
// can inject a fixture owner; prod's *postgres.OwnerRepo satisfies it as-is.
type OwnerGetter interface {
	GetByID(ctx context.Context, id string) (domain.Owner, error)
	FirstHandle(ctx context.Context) (string, error)
	GetByHandle(ctx context.Context, handle string) (domain.Owner, error)
}

// ConversationGetter —— the one chat method summarize_conversation needs.
// SummarizeDeps.Chats is this narrow port so the eval can inject a fixture that
// returns the eval conversation; VisitorDeps.Chats stays the concrete repo
// (broadly used by session/dialog persistence the eval doesn't exercise).
type ConversationGetter interface {
	GetWithMessages(ctx context.Context, ownerID, chatID string) (postgres.ChatWithMessages, error)
}
