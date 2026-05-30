// visitor_chat_stream.go —— streamReply + buildChatRequest +
// makeChatExecutor + pumpChunks。从 visitor_chat.go 拆出守 350-line cap。

package usecases

import (
	"context"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
)

// streamArgs —— streamReply 的入参打包；revive 限制函数最多 5 个参数。
type streamArgs struct {
	deps     *VisitorDeps
	provider inference.Provider
	in       *SendMessageInput
	out      chan<- MessageEvent
	retr     *retriever
	skills   *skillToolBundle
	extMCP   *externalMCPBundle
	booker   *bookerBundle
}

func streamReply(ctx context.Context, args *streamArgs) {
	defer close(args.out)
	defer releaseQuerySlot(args.deps, args.in.ConversationID)
	defer args.extMCP.Close()
	chunks, ierr := args.provider.Stream(ctx, buildChatRequest(args))
	if ierr != nil {
		args.out <- MessageEvent{Kind: "error", Err: ierr}
		return
	}
	full, ok := pumpChunks(chunks, args.out)
	if !ok {
		return
	}
	args.out <- emitDoneEvent(ctx, &doneInput{
		deps: args.deps, in: args.in, full: full, retr: args.retr,
	})
}

func buildChatRequest(args *streamArgs) *inference.ChatRequest {
	tools := append(retrievalToolSpecs(), args.skills.Specs()...)
	tools = append(tools, args.extMCP.Specs()...)
	tools = append(tools, args.booker.Specs()...)
	return &inference.ChatRequest{
		System:   buildSystemPrompt(roleSystemFragments(args.in.RoleSnapshot)),
		Messages: []inference.Message{{Role: "user", Content: args.in.Body}},
		Tools:    tools,
		ExecuteTool: makeChatExecutor(
			args.retr, args.skills, args.extMCP, args.booker,
		),
	}
}

// roleSystemFragments —— 把 RoleSnapshot 的 persona prompt + skill prompts
// 合并成系统 prompt 片段列表。snapshot nil 时返空。
func roleSystemFragments(snapshot *domain.RoleSnapshot) []string {
	if snapshot == nil {
		return []string{}
	}
	out := make([]string, 0, 1+len(snapshot.SkillPrompts()))
	if body := snapshot.PromptBody(); body != "" {
		out = append(out, body)
	}
	out = append(out, snapshot.SkillPrompts()...)
	return out
}

// makeChatExecutor —— 复合 dispatcher：
//   - skill_*       → sandbox bundle (owner-curated 脚本)
//   - ext_*         → external MCP bundle (owner-registered 外部 server)
//   - calendar.book → bookerBundle (Google Calendar booking)
//   - 其他          → retrieval bundle (search/read/list_corpus_entries)
func makeChatExecutor(
	retr *retriever, skills *skillToolBundle,
	ext *externalMCPBundle, booker *bookerBundle,
) inference.ToolExecutor {
	return func(ctx context.Context, name string, input []byte) (string, error) {
		if bookerHandles(booker, name) {
			return booker.Execute(ctx, name, input)
		}
		if skillsHandles(skills, name) {
			return skills.Execute(ctx, name, input)
		}
		if extHandles(ext, name) {
			return ext.Execute(ctx, name, input)
		}
		return retr.Execute(ctx, name, input)
	}
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
