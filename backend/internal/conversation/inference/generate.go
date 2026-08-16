// generate.go —— 一次性非流式 LLM 调用。caller (visitor_summary) 喂
// ChatRequest，返一段 text。走 eino model.BaseChatModel.Generate；
// provider 由 cred.Provider 决定，跟 proxy.Stream 同源。
//
// 跟 Stream 的差别只有"不开 SSE / 不 yield chunk"——request shape 一样，
// 这里直接复用 ChatRequest + toEinoMessages，省一套类型。

package inference

import (
	"context"
	"fmt"
)

// Generate —— build ChatModel + run Generate；返 assistant content。
// Tools 字段允许带 (eino 会发给上游)，但目前 visitor_summary 不带。
func Generate(ctx context.Context, cred *Cred, req *ChatRequest) (string, error) {
	cm, err := BuildChatModelBudgeted(ctx, pickModelCred(cred, req.Model), req.MaxTokens)
	if err != nil {
		return "", fmt.Errorf("eino: build chat model: %w", err)
	}
	einoMsgs, merr := toEinoMessages(req.System, req.Messages)
	if merr != nil {
		return "", merr
	}
	out, gerr := cm.Generate(ctx, einoMsgs)
	if gerr != nil {
		return "", fmt.Errorf("eino: generate: %w", gerr)
	}
	return out.Content, nil
}
