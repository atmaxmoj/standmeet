// events.go —— the event types this domain owns (docs/design/event-bus-outbox-webhooks.md,
// *Webhook event types*). Thin: never a message's text, never the visitor's name or address.

package usecase

import (
	"context"
	"log/slog"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Event types.
const (
	ConversationStarted = "conversation.started"
	ConversationMessage = "conversation.message"
	ConversationPruned  = "conversation.pruned"
	GhostAccepted       = "ghost.accepted"
)

// EventTypes —— the event types this domain owns.
func EventTypes() []events.Type {
	t := func(typ, desc, subject string) events.Type {
		return events.Type{Type: typ, Description: desc, Subject: subject, Exposure: events.Webhook}
	}
	conv := "conversation/<conversation id>"
	return []events.Type{
		t(ConversationStarted,
			"A visitor conversation began (data.conversation_id, data.mode).", conv),
		t(ConversationMessage,
			"A turn was added to a conversation: data.role is visitor or assistant "+
				"(data.conversation_id). Never the text.", conv),
		t(ConversationPruned,
			"Codeless conversations past the owner's retention were deleted (data.count).",
			"owner/<owner id>"),
		t(GhostAccepted,
			"A visitor took a suggested question (data.ghost_id, data.conversation_id).",
			"ghost/<ghost id>"),
	}
}

// PrunePeriodicJobs —— the codeless-conversation prune; each owner's delete and its
// conversation.pruned commit together.
func PrunePeriodicJobs(
	chats *repo.ChatRepo, log *slog.Logger, rec events.Recorder,
) []periodic.Job {
	return repo.PrunePeriodicJobs(chats, log,
		func(ctx context.Context, tx pgstore.Tx, ownerID string, n int64) error {
			return rec.With(tx).Record(ctx, ownerID, ConversationPruned, "owner/"+ownerID,
				map[string]int64{"count": n})
		})
}

// recordStarted ——conversation.started for chat, on rec (joined to the insert's transaction).
func recordStarted(ctx context.Context, rec events.Recorder, chat *entity.Chat) error {
	data := map[string]string{"conversation_id": chat.ID, "mode": string(chat.Mode)}
	//nolint:wrapcheck // Record names the type
	return rec.Record(ctx, chat.OwnerID, ConversationStarted, "conversation/"+chat.ID, data)
}

// inTx —— fn with a copy of deps whose code and chat writes and whose recorder join one
// transaction.
func (d *VisitorSessionDeps) inTx(
	ctx context.Context, fn func(t *VisitorSessionDeps) error,
) error {
	//nolint:wrapcheck // InTx names begin/commit; fn names its steps
	return pgstore.InTx(ctx, d.Chats.Pool(), func(tx pgstore.Tx) error {
		t := *d
		t.Codes, t.Chats, t.Events = d.Codes.With(tx), d.Chats.With(tx), d.Events.With(tx)
		return fn(&t)
	})
}

// createChat —— the chat row and its conversation.started, on deps (join a transaction first).
func createChat(
	ctx context.Context, deps *VisitorSessionDeps, in *repo.CreateChatInput,
) (entity.Chat, error) {
	chat, err := deps.Chats.CreateChat(ctx, in)
	if err != nil {
		return entity.Chat{}, err //nolint:wrapcheck // callers name the step
	}
	err = recordStarted(ctx, deps.Events, &chat)
	return chat, err
}

// createChatTx —— createChat in a transaction of its own.
func createChatTx(
	ctx context.Context, deps *VisitorSessionDeps, in *repo.CreateChatInput,
) (entity.Chat, error) {
	var chat entity.Chat
	err := deps.inTx(ctx, func(t *VisitorSessionDeps) error {
		var cerr error
		chat, cerr = createChat(ctx, t, in)
		return cerr
	})
	return chat, err
}

// recordRedeemed —— code.redeemed: a new member joined through code.
func recordRedeemed(
	ctx context.Context, deps *VisitorSessionDeps, codeID, ownerID, memberID string,
) error {
	data := map[string]string{"code_id": codeID, "member_id": memberID}
	//nolint:wrapcheck // Record names the type
	return deps.Events.Record(ctx, ownerID, access.CodeRedeemed, "code/"+codeID, data)
}
