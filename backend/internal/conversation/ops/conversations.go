// Package ops —— conversation 域对外能做的事,由域自己声明。
//
// 一个操作在这里是完整的一份:id、说明、入参 schema、语义类别、暴露意图、实现。
//
// 资源 conversations 有三件事:列出对话、读一整份逐字稿(连同 AI 当时引了哪些语料)、
// 以及 ghost-steering 的漏斗。
//
// 归一化时收掉的两处:
//
//   - 同一份逐字稿两个面差得很远。面板那份带 refs(标题 + 地址)和 ghost 日志;MCP 那份带
//     被引条目的**正文**(owner 拿它 debug 检索)。谁也不是谁的子集,于是 owner 从哪边看
//     都缺一半。现在是一份:refs 自带正文,ghost 日志每个面都有。
//   - 列表里的 code_id / code_value / client_ip 只有面板有 —— 从 Claude Code 看不出
//     "这次对话是哪张码进来的、从哪个 IP"。同一份载荷之后两边都看得到。
package ops

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// ConversationsDeps —— 对话本身 + ghost 日志 + 回读被引条目正文要用的语料仓储。
type ConversationsDeps struct {
	Chats  usecase.ConversationsDeps
	Ghosts usecase.GhostDeps
	Corpus corpus.Deps
	Log    *slog.Logger
}

// Conversations —— list / get / ghost_telemetry。全是只读。
func Conversations(d *ConversationsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "conversations.list",
			Description: "List the owner's visitor conversations, newest first: who, which " +
				"access code, how many turns, and the derived sentiment.",
			InputSchema: convListSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listConversations(d.Chats),
		},
		{
			ID: "conversations.get",
			Description: "Read one conversation in full: every message, the corpus entries " +
				"the assistant cited (with their bodies), and the ghost-steering log.",
			InputSchema: convIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getConversation(d),
		},
		{
			ID: "conversations.ghost_telemetry",
			Description: "Ghost-steering funnel per waypoint: how often a policy ghost was " +
				"shown, how often the visitor took it, and the resulting rate.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      ghostTelemetry(d.Ghosts),
		},
	}
}

var (
	noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

	convListSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"limit":{"type":"number","description":"Max rows (default 50, max 200)."}
		}
	}`)

	convIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"conversation_id":{"type":"string","description":"Conversation id."}},
		"required":["conversation_id"]
	}`)
)

type convLimitArgs struct {
	Limit int32 `json:"limit"`
}

// convLimit —— 只把数字解出来。**不**在这儿定默认值和上限:那条规则在域里
// (clampConvLimit)。0 就是"没说",域自己兜 —— 面各写一份 clamp 就成了三处规则。
func convLimit(raw json.RawMessage) int32 {
	var in convLimitArgs
	// 解不出就当没说,交给域兜默认值。
	if err := json.Unmarshal(raw, &in); err != nil {
		return 0
	}
	return in.Limit
}

func listConversations(deps usecase.ConversationsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListConversations(ctx, deps, ownerID, convLimit(raw))
		if err != nil {
			return nil, convErr(err)
		}
		out := make([]conversationOut, 0, len(rows))
		for i := range rows {
			out = append(out, toConversationOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

type convIDArgs struct {
	ConversationID string `json:"conversation_id"`
}

func getConversation(d *ConversationsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in convIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs(
			[2]string{"conversation_id", in.ConversationID}); err != nil {
			return nil, err
		}
		bundle, err := usecase.GetConversationTranscript(ctx, d.Chats, ownerID, in.ConversationID)
		if err != nil {
			return nil, convErr(err)
		}
		return json.Marshal(buildTranscript(ctx, d, ownerID, in.ConversationID, &bundle))
	}
}

func ghostTelemetry(deps usecase.GhostDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		stats, err := usecase.GhostTelemetry(ctx, &deps, ownerID)
		if err != nil {
			return nil, convErr(err)
		}
		return json.Marshal(toGhostFunnel(stats))
	}
}

// convErr —— 域的哨兵 → 协议无关的类别。code 是已经发出去的契约,显式钉住。
func convErr(err error) error {
	if errors.Is(err, entity.ErrChatNotFound) {
		return fp.Coded(fp.NotFound("conversation not found"), "not_found")
	}
	return fp.OpErr("conversation op", err)
}
