// visitor_chat_stream.go —— streamReply + buildChatRequest +
// makeChatExecutor + pumpChunks。从 visitor_chat.go 拆出守 350-line cap。
//
// B-3 后 retrieval / booker / skill-runner / ext-mcp 全部走 registry
// bindings；streamReply 不再持任何 legacy bundle 字段。

package usecases

import (
	"context"
	"strings"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/inference"
)

// streamArgs —— streamReply 的入参打包；revive 限制函数最多 5 个参数。
type streamArgs struct {
	provider inference.Provider
	deps     *VisitorDeps
	in       *SendMessageInput
	out      chan<- MessageEvent
	bindings []*agentskills.Binding
}

func streamReply(ctx context.Context, args *streamArgs) {
	defer close(args.out)
	defer releaseQuerySlot(args.deps, args.in.ConversationID)
	defer closeBindings(args.bindings)
	chunks, ierr := args.provider.Stream(ctx, buildChatRequest(ctx, args))
	if ierr != nil {
		args.out <- MessageEvent{Kind: "error", Err: ierr}
		return
	}
	full, ok := pumpChunks(chunks, args.out)
	if !ok {
		return
	}
	args.out <- emitDoneEvent(ctx, &doneInput{
		deps: args.deps, in: args.in, full: full, bindings: args.bindings,
	})
}

func buildChatRequest(ctx context.Context, args *streamArgs) *inference.ChatRequest {
	in := sendMsgToAssembleInput(args.in)
	return &inference.ChatRequest{
		System: args.deps.AgentSkills.ComposeSystemPrompt(
			ctx, ComposeBasePersona(args.in.RoleSnapshot), in,
		),
		Messages:    []inference.Message{{Role: "user", Content: args.in.Body}},
		Tools:       bindingToolSpecs(args.bindings),
		ExecuteTool: makeChatExecutor(args.bindings),
	}
}

// sendMsgToAssembleInput —— SendMessageInput → AssembleInput 浅拷贝。
// registry.AssembleVisitor / ComposeSystemPrompt 共用。
func sendMsgToAssembleInput(in *SendMessageInput) *agentskills.AssembleInput {
	return &agentskills.AssembleInput{
		RoleSnapshot:   in.RoleSnapshot,
		MaxBookings:    in.MaxBookings,
		OwnerID:        in.OwnerID,
		Mode:           in.Mode,
		CodeID:         in.CodeID,
		VisitorName:    in.VisitorName,
		ConversationID: in.ConversationID,
	}
}

// bindingToolSpecs —— flatten []*Binding 里所有 BindingTool.Spec。
func bindingToolSpecs(bindings []*agentskills.Binding) []inference.ToolSpec {
	out := make([]inference.ToolSpec, 0, len(bindings))
	for _, b := range bindings {
		for _, t := range b.Tools {
			out = append(out, t.Spec)
		}
	}
	return out
}

func closeBindings(bindings []*agentskills.Binding) {
	for _, b := range bindings {
		if b.Close != nil {
			b.Close()
		}
	}
}

// makeChatExecutor —— 走 registry bindings 的 lookup-by-name。匹中即调对应
// executor；找不到返 errJSON (LLM 看到 "unknown tool" 自然 fallback)。
func makeChatExecutor(bindings []*agentskills.Binding) inference.ToolExecutor {
	return func(ctx context.Context, name string, input []byte) (string, error) {
		if exec := lookupBindingTool(bindings, name); exec != nil {
			return exec(ctx, name, input)
		}
		return errJSON("unknown tool: " + name), nil
	}
}

func lookupBindingTool(
	bindings []*agentskills.Binding, name string,
) inference.ToolExecutor {
	for _, b := range bindings {
		for _, t := range b.Tools {
			if t.Spec.Name == name {
				return t.Execute
			}
		}
	}
	return nil
}

// pumpChunks 推送 token events；done 信号到达返 (full, true)；
// error chunk 已 emit error event 后返 ("", false)。
func pumpChunks(
	chunks <-chan inference.Chunk, out chan<- MessageEvent,
) (string, bool) {
	var parts []string
	for ch := range chunks {
		if ch.Error != nil {
			out <- MessageEvent{Kind: "error", Err: ch.Error}
			return "", false
		}
		if ch.Text != "" {
			parts = append(parts, ch.Text)
			out <- MessageEvent{Kind: "token", Text: ch.Text}
		}
		if ch.Done {
			return strings.Join(parts, ""), true
		}
	}
	return strings.Join(parts, ""), true
}
