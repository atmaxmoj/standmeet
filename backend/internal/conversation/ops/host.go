// host.go — the inbound side of what this domain opens to **sandboxed capabilities**.
//
// A sandboxed capability has no network access; it can only call back to the host over a
// unix socket. The domain itself decides which ops the host exposes — the same rule as the
// outbound half (conversations.go is outbound, this is inbound). Which of these ops a
// capability may call is declared in that capability's own manifest, and the host dispatches
// by that declaration; calling a name outside the declared list crashes at startup.
//
// All three ops serve capabilities like summarize: read this conversation's transcript, run
// one generation on the owner's LLM, and hand back the generated report to store.
// **Credentials never leave the host** — the sandbox gets a result, not a key.

package ops

import (
	"context"
	"encoding/json"
	"fmt"

	infcore "github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// HostDeps — what each of these three ops needs.
type HostDeps struct {
	Chats    ChatGetter
	Resolver infcore.Resolver
	Reports  usecase.ReportStore
}

// ChatGetter — reads one conversation's owner-scoped transcript (a narrow port; the
// composition root injects chatRepo).
type ChatGetter interface {
	GetWithMessages(
		ctx context.Context, ownerID, chatID string,
	) (repo.ChatWithMessages, error)
}

// HostOps —— conversation.read / inference.generate / report.store。
func HostOps(d HostDeps) []hostop.Op {
	return []hostop.Op{
		{
			Name: "conversation.read",
			Description: "Read this session's transcript, owner-scoped: " +
				"{owner_id, conversation_id} → {messages:[{role,content}]}.",
			Invoke: readConversation(d.Chats),
		},
		{
			Name: "inference.generate",
			Description: "Run one generation on the owner's LLM. The host resolves the " +
				"credential by owner + mode; the sandbox never sees a key.",
			Invoke: generateInference(d.Resolver),
		},
		{
			Name: "report.store",
			Description: "Hand back generated HTML: the host sanitises it against an " +
				"allow-list (security-critical, host-only), styles it and stores the report.",
			Invoke: storeReport(d.Reports),
		},
	}
}

// sockMessage — one message exchanged over the socket (role/content).
type sockMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func readConversation(chats ChatGetter) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req struct {
			OwnerID        string `json:"owner_id"`
			ConversationID string `json:"conversation_id"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("conversation.read: decode: %w", err)
		}
		bundle, err := chats.GetWithMessages(ctx, req.OwnerID, req.ConversationID)
		if err != nil {
			return nil, fmt.Errorf("conversation.read: %w", err)
		}
		return marshalTranscript(&bundle)
	}
}

// marshalTranscript — puts the transcript on the wire: role + content only. Other fields
// on a message row (internal id, billing, tool trace) never leave the host — the sandbox
// needs "what was said," not the row.
func marshalTranscript(bundle *repo.ChatWithMessages) (json.RawMessage, error) {
	msgs := make([]sockMessage, len(bundle.Messages))
	for i := range bundle.Messages {
		msgs[i] = sockMessage{Role: bundle.Messages[i].Role, Content: bundle.Messages[i].Body}
	}
	out, err := json.Marshal(map[string][]sockMessage{"messages": msgs})
	if err != nil {
		return nil, fmt.Errorf("conversation.read: marshal: %w", err)
	}
	return out, nil
}
