// visitor_conversations.go —— 一个 member 多段对话。浮窗在某篇 doc 上 find-or-create
// 自己那段对话(跟主聊天 / 别篇 doc 各自独立,transcript 不串),共享 member 级 turn
// 配额。docKey='' 是主聊天,session issue 时已建,不走这里。

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
	crossConvMaxMessages = 24   // 最多取该 member 其他对话末尾这么多条
	crossConvMaxChars    = 1500 // digest 总字符封顶,不让 prompt 爆
	crossConvBodyCap     = 240  // 单条 body 截断(rune 计)
)

// OpenConvForDocInput —— 浮窗开/续某 doc 那段对话的入参(从 visitor session 拿)。
type OpenConvForDocInput struct {
	OwnerID     string
	CodeID      string
	MemberID    string
	VisitorName string
	Mode        string
	DocKey      string
}

// OpenConversationForDoc —— 该 member 在 docKey 这个 surface 上的对话:已有未结束
// 的就续上,没有就新建。仅限 code 访客(有 member);缺 owner/member/docKey 返
// apierr.ErrEmptyField。
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

// BuildCrossConvDigest —— 「互通」digest:把该 member **其他**对话(排除当前 convID)
// 的近期消息压成一段紧凑文本,喂进 instruction 让 AI 跨对话连贯。空 member / 没别的
// 对话 → 空串。有界:只取末尾若干条、每条截断、总长封顶。
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

// ChatBelongsToMember —— turn handler 归属校验:这段 conversation 是否属于该
// member(owner-scoped 加载)。防访客借别人的 conversation_id 发 turn。
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
