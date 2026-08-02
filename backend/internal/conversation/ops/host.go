// host.go —— 本域开给**沙箱能力**的那几件事(入站方向)。
//
// 沙箱里的能力断了网,只能经一根 unix socket 回头问宿主。宿主开哪些口,由域自己说 ——
// 跟出站那半边同一条规矩(conversations.go 是出站,这里是入站)。谁能点这些口,由能力
// 在自己的 manifest 里声明,宿主按声明发;点了词表里没有的名字,启动就炸。
//
// 这三件都是 summarize 那类能力要的:读本次会话的逐字稿、借 owner 的 LLM 跑一次生成、
// 把生成的报告交回来存。**凭据永远不出宿主** —— 沙箱拿到的是结果,不是 key。

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

// HostDeps —— 这三件事各自要的那点东西。
type HostDeps struct {
	Chats    ChatGetter
	Resolver infcore.Resolver
	Reports  usecase.ReportStore
}

// ChatGetter —— 读一次会话的 owner-scoped 逐字稿(窄口,组装根注入 chatRepo)。
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

// sockMessage —— socket 上交换的一条消息(role/content)。
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

// marshalTranscript —— 逐字稿上线:只有 role + content。会话行上别的字段(内部 id、
// 计费、工具轨迹)不出宿主 —— 沙箱要的是"说了什么",不是那一行。
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
