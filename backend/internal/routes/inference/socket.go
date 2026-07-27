// Package inference —— socket controller:inference.generate host op。断网沙箱 cap 经 socket 让 host
// 用 owner 的 LLM 跑一次生成(host 按 owner+mode 解 cred,沙箱看不到 key)。按业务分类:它跟 inference
// 的调用面住一起,不进机制 bucket。信任模型同 connector.invoke。
package inference

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
	infcore "github.com/atmaxmoj/standmeet/internal/inference"
)

// genMsg —— socket op 交换的一条消息(role/content),本 controller 局部定义,不跨包耦合。
type genMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// RegisterInferenceGenerateOp —— 把 "inference.generate" 挂到 srv:{owner_id,mode,system,messages}
// → resolve cred → infcore.Generate → {output}。
func RegisterInferenceGenerateOp(srv *capsocket.Server, resolver infcore.Resolver) {
	srv.Handle("inference.generate", func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		return runInferenceGenerate(ctx, resolver, raw)
	})
}

func runInferenceGenerate(
	ctx context.Context, resolver infcore.Resolver, raw json.RawMessage,
) (json.RawMessage, error) {
	var req struct {
		OwnerID  string   `json:"owner_id"`
		Mode     string   `json:"mode"`
		System   string   `json:"system"`
		Messages []genMsg `json:"messages"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("inference.generate: decode: %w", err)
	}
	cred, cerr := resolver.Resolve(ctx,
		&infcore.ResolveInput{OwnerID: req.OwnerID, Mode: req.Mode})
	if cerr != nil {
		return nil, fmt.Errorf("inference.generate: resolve cred: %w", cerr)
	}
	chatReq := &infcore.ChatRequest{System: req.System, Messages: toChatMsgs(req.Messages)}
	out, gerr := infcore.Generate(ctx, cred, chatReq)
	if gerr != nil {
		return nil, fmt.Errorf("inference.generate: %w", gerr)
	}
	res, merr := json.Marshal(map[string]string{"output": out})
	if merr != nil {
		return nil, fmt.Errorf("inference.generate: marshal: %w", merr)
	}
	return res, nil
}

func toChatMsgs(in []genMsg) []infcore.ChatRequestMsg {
	out := make([]infcore.ChatRequestMsg, len(in))
	for i := range in {
		out[i] = infcore.ChatRequestMsg{Role: in[i].Role, Content: in[i].Content}
	}
	return out
}
