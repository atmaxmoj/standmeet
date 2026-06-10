// visitor_history.go —— 会话聚合读模型(凭 session token → member → open chat
// → conversation)。概念三层 code → session → conversation:
//
//   VisitorView { Session{ VisitorName, Code{ 配额 } }, Conversation{ Dialogs… } }
//
// 规则:
//   - count = len(Dialogs),没有 used 字段(前端自己数)。
//   - dialog 持久化 iff AI 答完 → 这里只配「answer 非空」的轮。
//   - 引用属于 dialog,从 messages.cited_* 解析成树派生 path,刷新不丢。
//   - visitor_name 归 session;配额归 code;summary 归 conversation(只暴露
//     ended + has_summary,全文另取)。
//   - 时间戳一律 serverside(message.CreatedAt / chat.StartedAt)。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
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

// ConvDialog —— 一段答完的交换:ghosts → question → answer + 引用 + serverside 时间。
type ConvDialog struct {
	CreatedAt time.Time
	Ghosts    []DialogGhost
	Question  string
	Answer    string
	Citations []DialogCitation
}

// Conversation / ConvCode / ConvSession / VisitorView 这几个 view 类型拆到
// conversation_view.go(本文件 max-public-structs 限制)。

// LoadVisitorView —— 凭 session data 拼出 {session, conversation}。无 code
// (public/byoai)→ Code 留零值;还没开会 → Conversation.Dialogs 空。
func LoadVisitorView(
	ctx context.Context, deps *VisitorDeps, data *session.VisitorSessionData,
) (VisitorView, error) {
	conv, err := loadConversation(ctx, deps, data.MemberID, data.OwnerID)
	if err != nil {
		return VisitorView{}, err
	}
	return VisitorView{
		Session: ConvSession{
			VisitorName: data.VisitorName,
			Code:        codeView(ctx, deps, data.CodeID),
		},
		Conversation: conv,
	}, nil
}

func codeView(ctx context.Context, deps *VisitorDeps, codeID string) ConvCode {
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

func countCodeMembers(ctx context.Context, deps *VisitorDeps, codeID string) int {
	members, err := deps.Codes.ListMembers(ctx, codeID)
	if err != nil {
		return 0
	}
	return len(members)
}

// loadConversation —— member → open chat → messages → 配对(只配答完的轮,带引用)。
// 还没开会(ErrChatNotFound)→ 空 conversation(不是错误)。
func loadConversation(
	ctx context.Context, deps *VisitorDeps, memberID, ownerID string,
) (Conversation, error) {
	if memberID == "" {
		return Conversation{}, nil
	}
	chat, err := deps.Chats.GetOpenChatByMember(ctx, memberID)
	if errors.Is(err, domain.ErrChatNotFound) {
		return Conversation{}, nil
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("open chat: %w", err)
	}
	bundle, err := deps.Chats.GetWithMessages(ctx, ownerID, chat.ID)
	if err != nil {
		return Conversation{}, fmt.Errorf("messages: %w", err)
	}
	r := newCitationResolver(ctx, deps, ownerID, bundle.Messages)
	return Conversation{
		StartedAt:  bundle.Chat.StartedAt,
		EndedAt:    bundle.Chat.EndedAt,
		Ended:      bundle.Chat.EndedAt != nil,
		HasSummary: bundle.Chat.SummaryMD != "",
		Dialogs:    pairDialogs(bundle.Messages, r),
	}, nil
}

// dialogAnswer —— visitor 问句后面那条 assistant 答的三件套(避开 3-return）。
type dialogAnswer struct {
	CreatedAt time.Time
	Body      string
	Citations []DialogCitation
}

// pairDialogs —— 每条 visitor 问句配它后面那条 assistant 答;只收 answer 非空的
// (dialog iff 答完)。ghosts 本轮先留空(落库恢复在后续轮接上)。
func pairDialogs(msgs []domain.Message, r *citationResolver) []ConvDialog {
	out := make([]ConvDialog, 0, len(msgs))
	for i := range msgs {
		if msgs[i].Role != "visitor" {
			continue
		}
		a := answerAfter(msgs, i, r)
		if a.Body != "" {
			out = append(out, ConvDialog{
				CreatedAt: a.CreatedAt, Question: msgs[i].Body, Answer: a.Body,
				Citations: a.Citations, Ghosts: []DialogGhost{},
			})
		}
	}
	return out
}

func answerAfter(msgs []domain.Message, i int, r *citationResolver) dialogAnswer {
	if i+1 < len(msgs) && msgs[i+1].Role == "assistant" {
		return dialogAnswer{
			CreatedAt: msgs[i+1].CreatedAt, Body: msgs[i+1].Body,
			Citations: r.resolve(&msgs[i+1]),
		}
	}
	return dialogAnswer{Citations: []DialogCitation{}}
}

// citationResolver —— cited id → DialogCitation(树派生 path + title)。整段会话
// 只 load 一次全树建表;没有任何引用就不 load,空表直接返空。
type citationResolver struct {
	wikiPaths    map[string]string
	wikiTitles   map[string]string
	outputPaths  map[string]string
	outputTitles map[string]string
}

func newCitationResolver(
	ctx context.Context, deps *VisitorDeps, ownerID string, msgs []domain.Message,
) *citationResolver {
	r := &citationResolver{}
	cited := collectCitedIDs(msgs)
	if len(cited.wikis) > 0 {
		if wikis, err := deps.Wiki.ListByOwner(ctx, ownerID, maxRAGWikis); err == nil {
			r.wikiPaths = WikiTreePaths(wikis)
			r.wikiTitles = wikiTitleMap(wikis)
		}
	}
	if len(cited.outputs) > 0 {
		if outputs, err := deps.Output.ListByOwner(ctx, ownerID, maxRAGOutputs); err == nil {
			r.outputPaths = OutputTreePaths(outputs)
			r.outputTitles = outputTitleMap(outputs)
		}
	}
	return r
}

func (r *citationResolver) resolve(m *domain.Message) []DialogCitation {
	out := make([]DialogCitation, 0, len(m.CitedWikiIDs)+len(m.CitedOutputIDs))
	out = appendCites(out, "wiki", m.CitedWikiIDs, r.wikiPaths, r.wikiTitles)
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

func wikiTitleMap(ws []domain.Wiki) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Title()
	}
	return m
}

func outputTitleMap(os []domain.Output) map[string]string {
	m := make(map[string]string, len(os))
	for i := range os {
		m[os[i].ID()] = os[i].Title()
	}
	return m
}
