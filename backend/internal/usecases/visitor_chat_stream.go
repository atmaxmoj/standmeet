// visitor_chat_stream.go —— streamReply + buildChatRequest +
// makeChatExecutor + pumpChunks。从 visitor_chat.go 拆出守 350-line cap。

package usecases

import (
	"context"
	"strings"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/inference"
)

// streamArgs —— streamReply 的入参打包；revive 限制函数最多 5 个参数。
// retrieval 已搬进 agentskills.Registry (B-2)，由 bindings 走；其他 3 个
// bundle (skills / extMCP / booker) 仍 legacy，B-3 一并 collapse。
type streamArgs struct {
	provider inference.Provider
	deps     *VisitorDeps
	in       *SendMessageInput
	out      chan<- MessageEvent
	skills   *skillToolBundle
	extMCP   *externalMCPBundle
	booker   *bookerBundle
	bindings []*agentskills.Binding
}

func streamReply(ctx context.Context, args *streamArgs) {
	defer close(args.out)
	defer releaseQuerySlot(args.deps, args.in.ConversationID)
	defer args.extMCP.Close()
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
	tools := bindingToolSpecs(args.bindings)
	tools = append(tools, args.skills.Specs()...)
	tools = append(tools, args.extMCP.Specs()...)
	tools = append(tools, args.booker.Specs()...)
	return &inference.ChatRequest{
		System: args.deps.AgentSkills.ComposeSystemPrompt(
			ctx, ComposeBasePersona(args.in.RoleSnapshot), in,
		),
		Messages: []inference.Message{{Role: "user", Content: args.in.Body}},
		Tools:    tools,
		ExecuteTool: makeChatExecutor(
			args.bindings, args.skills, args.extMCP, args.booker,
		),
	}
}

// sendMsgToAssembleInput —— SendMessageInput → AssembleInput 浅拷贝。
// registry.AssembleVisitor / ComposeSystemPrompt 共用。
func sendMsgToAssembleInput(in *SendMessageInput) *agentskills.AssembleInput {
	return &agentskills.AssembleInput{
		RoleSnapshot: in.RoleSnapshot,
		MaxBookings:  in.MaxBookings,
		OwnerID:      in.OwnerID,
		Mode:         in.Mode,
		CodeID:       in.CodeID,
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

// legacyBundles —— 把 3 个还没搬进 registry 的 bundle 打包，让 dispatcher
// argument-limit ≤ 5。B-3 collapse 完后整个 struct 删掉。
type legacyBundles struct {
	skills *skillToolBundle
	ext    *externalMCPBundle
	booker *bookerBundle
}

// makeChatExecutor —— 复合 dispatcher：
//   - bindings 里任一 tool name 匹中 → 该 binding executor
//   - 否则 fall through 到 legacy bundles (skills / ext / booker)
//
// legacy 路径 B-3 一并搬进 registry，届时整个 legacyBundles 消失。
func makeChatExecutor(
	bindings []*agentskills.Binding, skills *skillToolBundle,
	ext *externalMCPBundle, booker *bookerBundle,
) inference.ToolExecutor {
	legacy := &legacyBundles{skills: skills, ext: ext, booker: booker}
	return func(ctx context.Context, name string, input []byte) (string, error) {
		if exec := lookupBindingTool(bindings, name); exec != nil {
			return exec(ctx, name, input)
		}
		return legacy.dispatch(ctx, name, input)
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

func (l *legacyBundles) dispatch(
	ctx context.Context, name string, input []byte,
) (string, error) {
	if bookerHandles(l.booker, name) {
		return l.booker.Execute(ctx, name, input)
	}
	if skillsHandles(l.skills, name) {
		return l.skills.Execute(ctx, name, input)
	}
	if extHandles(l.ext, name) {
		return l.ext.Execute(ctx, name, input)
	}
	return errJSON("unknown tool: " + name), nil
}

func bookerHandles(b *bookerBundle, name string) bool {
	return b != nil && b.Has(name)
}

func skillsHandles(s *skillToolBundle, name string) bool {
	return s != nil && s.Has(name)
}

func extHandles(e *externalMCPBundle, name string) bool {
	return e != nil && e.Has(name)
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
