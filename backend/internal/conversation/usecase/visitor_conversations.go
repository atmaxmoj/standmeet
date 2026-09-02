// visitor_conversations.go —— one member, multiple conversation segments. The floating
// widget on a given doc does a find-or-create for its own conversation segment
// (independent from the main chat / other docs, transcripts don't mix), sharing the
// member-level turn quota. docKey='' is the main chat, already created at session issue,
// doesn't go through this path.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

const (
	// crossConvMaxMessages caps how many messages are taken from the tail of the member's
	// other conversations.
	crossConvMaxMessages = 24
	crossConvMaxChars    = 1500 // digest total char cap, keeps the prompt from ballooning
	crossConvBodyCap     = 240  // per-message body truncation (counted in runes)
)

// OpenConvForDocInput —— input for the floating widget opening/resuming a doc's
// conversation segment (taken from the visitor session).
type OpenConvForDocInput struct {
	OwnerID     string
	CodeID      string
	MemberID    string
	VisitorName string
	Mode        string
	DocKey      string
}

// OpenConversationForDoc —— this member's conversation on the docKey surface: resumes
// an unfinished one if it exists, otherwise creates a new one. Code visitors only (has a
// member); missing owner/member/docKey returns apierr.ErrEmptyField.
func OpenConversationForDoc(
	ctx context.Context, deps *VisitorSessionDeps, in *OpenConvForDocInput,
) (entity.Chat, error) {
	if !validOpenConvInput(in) {
		return entity.Chat{}, apierr.ErrEmptyField
	}
	existing, gerr := deps.Chats.GetOpenChatByMemberAndDoc(ctx, in.MemberID, in.DocKey)
	if gerr == nil {
		return existing, nil
	}
	if !errors.Is(gerr, entity.ErrChatNotFound) {
		return entity.Chat{}, fmt.Errorf("lookup member doc chat: %w", gerr)
	}
	return createDocConversation(ctx, deps, in)
}

func validOpenConvInput(in *OpenConvForDocInput) bool {
	return in.OwnerID != "" && in.MemberID != "" && in.DocKey != ""
}

func createDocConversation(
	ctx context.Context, deps *VisitorSessionDeps, in *OpenConvForDocInput,
) (entity.Chat, error) {
	memberID := in.MemberID
	chat, err := deps.Chats.CreateChat(ctx, &repo.CreateChatInput{
		OwnerID:     in.OwnerID,
		Mode:        in.Mode,
		CodeID:      nullableProvider(in.CodeID),
		MemberID:    &memberID,
		VisitorName: in.VisitorName,
		DocKey:      in.DocKey,
	})
	if err != nil {
		return entity.Chat{}, fmt.Errorf("create doc chat: %w", err)
	}
	return chat, nil
}

// BuildCrossConvDigest —— the "cross-linked" digest: compresses this member's recent
// messages from **other** conversations (excluding the current convID) into a compact
// block of text, fed into the instruction so the AI stays coherent across conversations.
// Empty member / no other conversations → empty string. Bounded: only the last N
// messages, each truncated, total length capped.
func BuildCrossConvDigest(
	ctx context.Context, deps *VisitorSessionDeps, memberID, excludeConvID string,
) (string, error) {
	if memberID == "" || excludeConvID == "" {
		return "", nil
	}
	msgs, err := deps.Chats.ListMemberOtherMessages(ctx, memberID, excludeConvID)
	if err != nil {
		return "", fmt.Errorf("list member other messages: %w", err)
	}
	return formatCrossConvDigest(msgs), nil
}

func formatCrossConvDigest(msgs []repo.MemberOtherMessage) string {
	if len(msgs) > crossConvMaxMessages {
		msgs = msgs[len(msgs)-crossConvMaxMessages:]
	}
	lines := make([]string, 0, len(msgs))
	total := 0
	for i := range msgs {
		line := crossConvLine(&msgs[i])
		if total+len(line) > crossConvMaxChars {
			break
		}
		lines = append(lines, line)
		total += len(line)
	}
	return strings.Join(lines, "")
}

func crossConvLine(m *repo.MemberOtherMessage) string {
	where := "main chat"
	if m.DocKey != "" {
		where = m.DocKey
	}
	return "- [" + where + "] " + m.Role + ": " + capRunes(m.Body, crossConvBodyCap) + "\n"
}

func capRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// ChatBelongsToMember —— ownership check for the turn handler: whether this
// conversation belongs to this member (loaded owner-scoped). Prevents a visitor from
// borrowing someone else's conversation_id to send a turn.
func ChatBelongsToMember(
	ctx context.Context, deps *VisitorSessionDeps, ownerID, convID, memberID string,
) (bool, error) {
	conv, err := deps.Chats.GetChat(ctx, ownerID, convID)
	if err != nil {
		if errors.Is(err, entity.ErrChatNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("load conv for ownership: %w", err)
	}
	return conv.MemberID != nil && *conv.MemberID == memberID, nil
}
