// agent_turn_suggestions.go —— H.13.a: code-accessor session 的 turn
// 收尾前生成 3 条 follow-up question + emit `suggestions` SSE 帧。
// 从 agent_turn.go 拆出来守 max-lines 350 cap。
//
// 触发只在 mode='code' (持 access code 的 visitor)；public / byoai 跳。
// LLM 调失败 / 输出不是 JSON 数组 → 静默降级 emit items=[]，浏览器看
// 不到 ghost text 但 wire 不挂。

package inference

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// followupGenPrompt —— 让 LLM 出 follow-up 的固定 prompt 模板。强调
// JSON-only 输出方便机器解析；length cap 防止 LLM 写长句撑爆 ghost
// text overlay。
const followupGenPrompt = "You will be given a short snippet of a " +
	"conversation between a visitor and an AI assistant about the AI's " +
	"owner. Suggest exactly 3 short follow-up questions the visitor " +
	"might naturally want to ask next. Each question must be ≤ 60 " +
	"characters and feel natural for the visitor to ask in first " +
	"person.\n\n" +
	"Respond with ONLY a JSON array of 3 strings. No markdown, no prose, " +
	"no surrounding code fence. Example output:\n" +
	`["Tell me about X?","How did you Y?","What about Z?"]`

// maybeEmitSuggestions —— code-accessor session turn 收尾前调
// inference.Generate 出 3 条 follow-up，emit `suggestions` SSE 帧。
// 非 code-accessor / 空 assistant 回复 / Generate 失败 / 输出非 JSON
// → 不 emit 或 emit items=[]，浏览器视作 "no chip"。
func maybeEmitSuggestions(
	ctx context.Context, em *loopEmit, in *AgentTurnInput, state *turnState,
) {
	if in.Mode != "code" {
		return
	}
	if state.assistantText == "" {
		return
	}
	items, err := generateFollowups(ctx, in, state.assistantText)
	if err != nil {
		em.log.Warn("agent turn suggestions generate", logErrKey, err)
		em.sink.Suggestions([]string{})
		return
	}
	em.sink.Suggestions(items)
}

func generateFollowups(
	ctx context.Context, in *AgentTurnInput, assistantText string,
) ([]string, error) {
	userBody := fmt.Sprintf(
		"Visitor asked:\n%s\n\nAssistant answered:\n%s",
		in.Req.UserMessage, assistantText,
	)
	out, err := Generate(ctx, in.Cred, &ChatRequest{
		System: followupGenPrompt,
		Messages: []ChatRequestMsg{
			{Role: "user", Content: userBody},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("generate follow-ups: %w", err)
	}
	var items []string
	if uerr := json.Unmarshal([]byte(strings.TrimSpace(out)), &items); uerr != nil {
		return nil, fmt.Errorf("follow-ups json: %w", uerr)
	}
	return items, nil
}
