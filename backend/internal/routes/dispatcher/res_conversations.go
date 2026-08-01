// res_conversations.go —— 资源 conversations:访客跟这台实例的每一次对话。
//
// 三件事:列出对话、读一整份逐字稿(连同 AI 当时引了哪些语料)、以及 ghost-steering 的漏斗。
//
// 迁移时发现的两处:
//
//   - 同一份逐字稿两个面差得很远。面板那份带 refs(标题 + 地址)和 ghost 日志;MCP 那份带
//     被引条目的**正文**(owner 拿它 debug 检索)。谁也不是谁的子集,于是 owner 从哪边看
//     都缺一半。现在是一份:refs 自带正文,ghost 日志两个面都有。
//   - 列表里的 code_id / code_value / client_ip 只有面板有 —— 从 Claude Code 看不出
//     "这次对话是哪张码进来的、从哪个 IP"。同一份载荷之后两边都看得到。

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// ConversationStore —— conversations 这组操作所需的最小口。载荷形状在
// res_conversations_shape.go(收口这边),适配器只做域实体 → 那些类型的映射。
type ConversationStore interface {
	List(ctx context.Context, ownerID string, limit int32) ([]Conversation, error)
	Transcript(ctx context.Context, ownerID, convID string) (Transcript, error)
	GhostTelemetry(ctx context.Context, ownerID string) (GhostFunnel, error)
}

// Conversations —— conversations 资源。
func Conversations(store ConversationStore) Resource {
	return Resource{Name: "conversations", Ops: []Op{
		{
			ID: "conversations.list",
			Description: "List the owner's visitor conversations, newest first: who, which " +
				"access code, how many turns, and the derived sentiment.",
			InputSchema: convListSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      conversationsList(store),
		},
		{
			ID: "conversations.get",
			Description: "Read one conversation in full: every message, the corpus entries " +
				"the assistant cited (with their bodies), and the ghost-steering log.",
			InputSchema: convIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      conversationsGet(store),
		},
		{
			ID: "conversations.ghost_telemetry",
			Description: "Ghost-steering funnel per waypoint: how often a policy ghost was " +
				"shown, how often the visitor took it, and the resulting rate.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      conversationsGhostTelemetry(store),
		},
	}}
}

var convListSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"limit":{"type":"number","description":"Max rows (default 50, max 200)."}
	}
}`)

var convIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"conversation_id":{"type":"string","description":"Conversation id."}},
	"required":["conversation_id"]
}`)

type convLimitArgs struct {
	Limit int32 `json:"limit"`
}

// convLimit —— 只把数字解出来。**不**在这儿定默认值和上限:那条规则在 conversation 域里
// (clampConvLimit)。0 就是"没说",域自己兜 —— 面各写一份 clamp 就成了三处规则。
func convLimit(raw json.RawMessage) int32 {
	var in convLimitArgs
	// 解不出就当没说,交给域兜默认值。
	if err := json.Unmarshal(raw, &in); err != nil {
		return 0
	}
	return in.Limit
}

func conversationsList(store ConversationStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID, convLimit(raw))
		if err != nil {
			return nil, opErr("list conversations", err)
		}
		if rows == nil {
			rows = []Conversation{}
		}
		return marshalOut(rows)
	}
}

type convIDArgs struct {
	ConversationID string `json:"conversation_id"`
}

func conversationsGet(store ConversationStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in convIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.ConversationID == "" {
			return nil, BadInput("conversation_id is required")
		}
		t, err := store.Transcript(ctx, ownerID, in.ConversationID)
		if err != nil {
			return nil, opErr("read transcript", err)
		}
		return marshalOut(t)
	}
}

func conversationsGhostTelemetry(store ConversationStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		funnel, err := store.GhostTelemetry(ctx, ownerID)
		if err != nil {
			return nil, opErr("read ghost telemetry", err)
		}
		return marshalOut(funnel)
	}
}
