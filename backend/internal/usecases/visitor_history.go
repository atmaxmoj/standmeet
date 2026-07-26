// visitor_history.go —— 会话聚合读模型(凭 session token → member → open chat
// → conversation)。概念三层 code → session → conversation:
//
//   VisitorView { Session{ VisitorName, Code{ 配额 } }, Conversation{ Dialogs… } }
//
// 规则:
//   - count = len(Dialogs),没有 used 字段(前端自己数)。
//   - dialog 持久化 iff 这轮产出了内容:answer 非空,或 return_directly 工具的结果
//     (summarize 报告卡 —— 空 answer + 非空 tool_calls;F-A-19)。纯 narration 轮不落。
//   - 引用属于 dialog,从 messages.cited_* 解析成树派生 path,刷新不丢。
//   - visitor_name 归 session;配额归 code;summary 是独立 chat_reports artifact
//     (一会话一份),不挂 conversation 视图。
//   - 时间戳一律 serverside(message.CreatedAt / chat.StartedAt)。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// DialogGhost —— 这条 question 之前显示的一个候选 ghost + 是否被选中。
type DialogGhost struct {
	Text     string
	Selected bool
}

// DialogCitation —— 一条引用:genre + 树派生 path + title。
type DialogCitation struct {
	Genre string
	Path  string
	Title string
}

// ConvDialog —— 一段答完的交换:ghosts → question → answer + 引用 + 本轮 tool
// 调用(opaque jsonb)+ serverside 时间。
type ConvDialog struct {
	CreatedAt time.Time
	Ghosts    []DialogGhost
	Question  string
	Answer    string
	Citations []DialogCitation
	ToolCalls []byte
}

// Conversation / ConvCode / ConvSession / VisitorView 这几个 view 类型拆到
// conversation_view.go(本文件 max-public-structs 限制)。

// LoadVisitorView —— 凭 session data 拼出 {session, conversation}。无 code
// (public/byoai)→ Code 留零值;还没开会 → Conversation.Dialogs 空。
func LoadVisitorView(
	ctx context.Context, deps *VisitorSessionDeps, data *session.VisitorSessionData,
) (VisitorView, error) {
	conv, err := loadConversation(ctx, deps, data.MemberID, data.OwnerID)
	if err != nil {
		return VisitorView{}, err
	}
	return VisitorView{
		Session: ConvSession{
			VisitorName: data.Visitor.Name,
			Code:        codeView(ctx, deps, data.CodeID),
			UsedTurns:   memberUsedTurns(ctx, deps, data.MemberID),
		},
		Conversation: conv,
	}, nil
}

// memberUsedTurns —— 该 member 跨全部对话的访客发言合计(member 级 used)。无
// member(public/byoai)/ 数不出来 → 0。前端 strip 据此显 used。
func memberUsedTurns(ctx context.Context, deps *VisitorSessionDeps, memberID string) int32 {
	if memberID == "" {
		return 0
	}
	n, err := deps.Chats.CountVisitorTurnsForMember(ctx, memberID)
	if err != nil {
		return 0
	}
	return n
}

func codeView(ctx context.Context, deps *VisitorSessionDeps, codeID string) ConvCode {
	if codeID == "" {
		return ConvCode{}
	}
	code, err := deps.Codes.GetByID(ctx, codeID)
	if err != nil {
		return ConvCode{}
	}
	return ConvCode{
		MaxTurnsPerSession: posInt32(code.MaxTurnsPerSession),
		MaxMembers:         posInt32(code.MaxMembers),
		MemberCount:        countCodeMembers(ctx, deps, codeID),
	}
}

// posInt32 —— *int32 取正值,nil / ≤0 → 0(0 = 不限,前端不画 gauge)。
func posInt32(p *int32) int32 {
	if p != nil && *p > 0 {
		return *p
	}
	return 0
}

func countCodeMembers(ctx context.Context, deps *VisitorSessionDeps, codeID string) int {
	members, err := deps.Codes.ListMembers(ctx, codeID)
	if err != nil {
		return 0
	}
	return len(members)
}

// loadConversation —— member → open chat → messages → 配对(只配答完的轮,带引用)。
// 还没开会(ErrChatNotFound)→ 空 conversation(不是错误)。
func loadConversation(
	ctx context.Context, deps *VisitorSessionDeps, memberID, ownerID string,
) (Conversation, error) {
	if memberID == "" {
		return Conversation{}, nil
	}
	chat, err := deps.Chats.GetOpenChatByMember(ctx, memberID)
	if errors.Is(err, conversation.ErrChatNotFound) {
		return Conversation{}, nil
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("open chat: %w", err)
	}
	return ConversationForChat(ctx, deps, ownerID, chat.ID)
}

// ConversationForChat —— 把某一段 conversation(按 id,owner-scoped)组装成视图
// (dialogs + citations)。主聊天恢复走 loadConversation,浮窗那段对话走这个。
func ConversationForChat(
	ctx context.Context, deps *VisitorSessionDeps, ownerID, chatID string,
) (Conversation, error) {
	bundle, err := deps.Chats.GetWithMessages(ctx, ownerID, chatID)
	if err != nil {
		return Conversation{}, fmt.Errorf("messages: %w", err)
	}
	r := newCitationResolver(ctx, deps, ownerID, bundle.Messages)
	return Conversation{
		StartedAt: bundle.Chat.StartedAt,
		Dialogs:   pairDialogs(bundle.Messages, r),
	}, nil
}

// dialogAnswer —— visitor 问句后面那条 assistant 答的几件套(避开多 return）。
type dialogAnswer struct {
	CreatedAt time.Time
	Body      string
	Citations []DialogCitation
	ToolCalls []byte
}

// pairDialogs —— 每条 visitor 问句配它后面那条 assistant 答;收「答完的」轮:answer 非空 **或**
// 带 tool_calls(F-A-19:return_directly 工具如 summarize 无答案文本,产物就是 tool 结果那张报告卡 —
// 空 body 但 tool_calls 非空;丢掉它就等于 reload 后访客丢了自己生成的报告)。ghosts 本轮先留空。
//
// 只有 return_directly 轮会以「空 body + tool_calls」落库(persistTurn 的 producedContentForPersist:
// 纯 grounding narration 不落),所以这里放行带 tool 的空答案不会把 F-A-4 的规划旁白放进来。
func pairDialogs(msgs []conversation.Message, r *citationResolver) []ConvDialog {
	out := make([]ConvDialog, 0, len(msgs))
	for i := range msgs {
		if msgs[i].Role != "visitor" {
			continue
		}
		a := answerAfter(msgs, i, r)
		if a.Body != "" || toolCallsNonEmpty(a.ToolCalls) {
			out = append(out, ConvDialog{
				CreatedAt: a.CreatedAt, Question: msgs[i].Body, Answer: a.Body,
				Citations: a.Citations, Ghosts: []DialogGhost{}, ToolCalls: a.ToolCalls,
			})
		}
	}
	return out
}

// toolCallsNonEmpty —— 落库的 tool_calls JSON 是否携带真内容(非 nil / `null` / `[]`)。
func toolCallsNonEmpty(raw []byte) bool {
	s := strings.TrimSpace(string(raw))
	return s != "" && s != "null" && s != "[]"
}

func answerAfter(msgs []conversation.Message, i int, r *citationResolver) dialogAnswer {
	if i+1 < len(msgs) && msgs[i+1].Role == "assistant" {
		return dialogAnswer{
			CreatedAt: msgs[i+1].CreatedAt, Body: msgs[i+1].Body,
			Citations: r.resolve(&msgs[i+1]), ToolCalls: msgs[i+1].ToolCalls,
		}
	}
	return dialogAnswer{Citations: []DialogCitation{}}
}

// citationResolver —— cited id → DialogCitation(树派生 path + title)。整段会话
// 只 load 一次全树建表;没有任何引用就不 load,空表直接返空。
type citationResolver struct {
	wikiPaths     map[string]string
	wikiTitles    map[string]string
	writingPaths  map[string]string
	writingTitles map[string]string
	outputPaths   map[string]string
	outputTitles  map[string]string
}

// maxRAGWikis / maxRAGOutputs —— citation 反查时载入 owner 语料算树派生 path 的窗口上限。
const (
	maxRAGWikis   = 50
	maxRAGOutputs = 50
)

func newCitationResolver(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string,
	msgs []conversation.Message,
) *citationResolver {
	r := &citationResolver{}
	cited := collectCitedIDs(msgs)
	r.loadWikis(ctx, deps, ownerID, cited.wikis)
	r.loadWritings(ctx, deps, ownerID, cited.writings)
	r.loadOutputs(ctx, deps, ownerID, cited.outputs)
	return r
}

func (r *citationResolver) loadWikis(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, ids []string,
) {
	if len(ids) == 0 {
		return
	}
	if wikis, err := deps.Wiki.ListByOwner(ctx, ownerID, maxRAGWikis); err == nil {
		r.wikiPaths = WikiTreePaths(wikis)
		r.wikiTitles = wikiTitleMap(wikis)
	}
}

func (r *citationResolver) loadWritings(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, ids []string,
) {
	if len(ids) == 0 || deps.Writing == nil {
		return
	}
	if writings, err := deps.Writing.ListPublishedByOwner(ctx, ownerID); err == nil {
		r.writingPaths = writingPathMap(writings)
		r.writingTitles = writingTitleMap(writings)
	}
}

func (r *citationResolver) loadOutputs(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, ids []string,
) {
	if len(ids) == 0 {
		return
	}
	if outputs, err := deps.Output.ListByOwner(ctx, ownerID, maxRAGOutputs); err == nil {
		r.outputPaths = OutputTreePaths(outputs)
		r.outputTitles = outputTitleMap(outputs)
	}
}

func (r *citationResolver) resolve(m *conversation.Message) []DialogCitation {
	out := make([]DialogCitation, 0,
		len(m.CitedWikiIDs)+len(m.CitedWritingIDs)+len(m.CitedOutputIDs))
	out = appendCites(out, "wiki", m.CitedWikiIDs, r.wikiPaths, r.wikiTitles)
	out = appendCites(out, "writing", m.CitedWritingIDs, r.writingPaths, r.writingTitles)
	out = appendCites(out, "output", m.CitedOutputIDs, r.outputPaths, r.outputTitles)
	return out
}

func appendCites(
	out []DialogCitation, genre string, ids []string, paths, titles map[string]string,
) []DialogCitation {
	for _, id := range ids {
		path, ok := paths[id]
		if !ok {
			continue
		}
		out = append(out, DialogCitation{Genre: genre, Path: path, Title: titles[id]})
	}
	return out
}

func wikiTitleMap(ws []corpus.Wiki) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Title()
	}
	return m
}

func outputTitleMap(os []corpus.Output) map[string]string {
	m := make(map[string]string, len(os))
	for i := range os {
		m[os[i].ID()] = os[i].Title()
	}
	return m
}

// writingPathMap —— writing 自带 slug 派生的 path 列("writings/"+slug),不用上溯树。
func writingPathMap(ws []corpus.Writing) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Path()
	}
	return m
}

func writingTitleMap(ws []corpus.Writing) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Title()
	}
	return m
}
