// agent_turn.go —— POST /api/v1/agent/turn
//
// H.9: visitor agent loop 搬 backend，走 eino ADK ChatModelAgent。
// Handler 的 4 件事：
//   1. visitor session 鉴权
//   2. 解 body (system + user_message + history)
//   3. 装配 visitor capability bindings → 抽 []tool.BaseTool 喂 ADK
//   4. 调 inference.RunAgentTurn 让它跑 + 流 pi-style SSE
//
// 跟 /llm/chat/stream 并存：H.9.a 起 /llm/chat/stream 仍可用 (浏览器旧
// pi-agent-core 还在用)；H.10 切完 SDK 之后 /llm/chat/stream 才会废弃。

package public

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/cloudwego/eino/components/tool"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
)

func (h *Handlers) agentTurn() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		var req inference.AgentTurnRequest
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runAgentTurn(h, w, r, auth, &req)
	}
}

func runAgentTurn(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	auth authedVisitor, req *inference.AgentTurnRequest,
) {
	cred, cerr := resolveAgentTurnCred(r, h, auth)
	if cerr != nil {
		writeLLMPreStreamErr(h, w, cerr)
		return
	}
	bindings, tools := collectVisitorTools(r.Context(), h, auth, req.System)
	defer closeBindings(bindings)
	inference.RunAgentTurn(r.Context(), h.Log, w, &inference.AgentTurnInput{
		Cred: cred, Req: req, Tools: tools,
	})
}

func resolveAgentTurnCred(
	r *http.Request, h *Handlers, auth authedVisitor,
) (*inference.Cred, error) {
	byoai := pickAgentTurnBYOAICred(h, auth, r)
	return h.Visitor.Resolver.Resolve(r.Context(), &inference.ResolveInput{
		OwnerID: auth.Data.OwnerID, Mode: auth.Data.Mode, BYOAI: byoai,
	})
}

func pickAgentTurnBYOAICred(
	h *Handlers, auth authedVisitor, r *http.Request,
) *domain.AICredential {
	if auth.Data.Mode != "byoai" {
		return nil
	}
	cred, _ := readBYOAICredFromHeaders(h, &nopResponseWriter{}, r, auth.Token)
	return cred
}

// collectVisitorTools —— 装配本 session 的所有 visitor binding，抽
// BindingTool.Tool 拼成 ADK ChatModelAgent 要的 []tool.BaseTool。
// 第一返：原始 bindings (caller defer close 释放 ext-mcp 等资源)；
// 第二返：tool 集合直接喂 eino。
//
// system 参数透到 AssembleInput 是兼容老结构 (PromptSnapshot 字段)，本
// slice 不真用，跟 /llm/chat/stream 同一签名套路。
func collectVisitorTools(
	ctx context.Context, h *Handlers, auth authedVisitor, _ string,
) ([]*agentskills.Binding, []tool.BaseTool) {
	in := assembleInputFromSession(auth.Data, "")
	bindings := h.Visitor.AgentSkills.AssembleVisitor(ctx, in)
	tools := make([]tool.BaseTool, 0)
	for _, b := range bindings {
		for i := range b.Tools {
			tools = append(tools, b.Tools[i].Tool)
		}
	}
	return bindings, tools
}
