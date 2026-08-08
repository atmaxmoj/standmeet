// conversations_shape.go —— 对话的出站载荷形状(每个面同一份),以及域实体 → 它们的映射。
//
// 合并前:面板那份带 refs(标题 + 地址)和 ghost 日志、MCP 那份带被引条目的**正文**
// (owner 拿它 debug 检索),谁也不是谁的子集;列表里的 code_id / code_value / client_ip
// 也只有面板有。现在一份。
//
// ghost 日志和被引条目的正文都是 best-effort:它们是旁证,取不到不该让整份逐字稿失败。

package ops

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// conversationOut —— 对话列表里的一行。
type conversationOut struct {
	CodeID      *string `json:"code_id,omitempty"`
	CodeLabel   *string `json:"code_label,omitempty"`
	CodeValue   *string `json:"code_value,omitempty"`
	StartedAt   string  `json:"started_at"`
	LastAt      string  `json:"last_at"`
	ID          string  `json:"id"`
	Mode        string  `json:"mode"`
	VisitorName string  `json:"visitor_name"`
	Sentiment   string  `json:"sentiment"`
	ClientIP    string  `json:"client_ip"`
	Turns       int32   `json:"turns"`
	PrivateHits int32   `json:"private_hits"`
}

// messageOut —— 逐字稿里的一条消息,连同它引了哪些条目。
type messageOut struct {
	CreatedAt            string   `json:"created_at"`
	ID                   string   `json:"id"`
	Role                 string   `json:"role"`
	Body                 string   `json:"body"`
	CitedWikiIDs         []string `json:"cited_wiki_ids"`
	CitedWritingIDs      []string `json:"cited_writing_ids"`
	CitedOutputIDs       []string `json:"cited_output_ids"`
	CitedSubjectivityIDs []string `json:"cited_subjectivity_ids"`
}

// citedRefOut —— 一条被引条目。Body 是 owner debug 检索时最想看的那半边(以前只有 MCP 有);
// 取不到就是空串 —— 一条引用读不出正文,不该让整份逐字稿失败。
type citedRefOut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
	Body  string `json:"body"`
}

// ghostShownOut —— 给这次对话打过的一条 ghost 提示,以及访客有没有接。
type ghostShownOut struct {
	AcceptedAt *string `json:"accepted_at,omitempty"`
	ID         string  `json:"id"`
	GhostText  string  `json:"ghost_text"`
	Source     string  `json:"source"`
	ShownAt    string  `json:"shown_at"`
	TurnIndex  int32   `json:"turn_index"`
	Accepted   bool    `json:"accepted"`
}

// transcriptOut —— 一整份逐字稿。
type transcriptOut struct {
	Conversation     conversationOut `json:"conversation"`
	Messages         []messageOut    `json:"messages"`
	WikiRefs         []citedRefOut   `json:"wiki_refs"`
	WritingRefs      []citedRefOut   `json:"writing_refs"`
	OutputRefs       []citedRefOut   `json:"output_refs"`
	SubjectivityRefs []citedRefOut   `json:"subjectivity_refs"`
	// GroundingRefs —— 塑造了这一轮、但没 opt-in 的 subjectivity(F-A-27)。只有标题和地址,
	// 没有正文 —— owner 要判的是「哪几条在起作用」,私有正文不复制进这份回参。
	GroundingRefs []citedRefOut   `json:"grounding_refs"`
	Ghosts        []ghostShownOut `json:"ghosts"`
}

func buildTranscript(
	ctx context.Context, d *ConversationsDeps, ownerID, convID string,
	bundle *usecase.TranscriptBundle,
) transcriptOut {
	msgs := make([]messageOut, 0, len(bundle.ConvBundle.Messages))
	for i := range bundle.ConvBundle.Messages {
		msgs = append(msgs, toMessageOut(&bundle.ConvBundle.Messages[i]))
	}
	return transcriptOut{
		Conversation: summaryFromBundle(&bundle.ConvBundle),
		Messages:     msgs,
		// wiki / output 的正文按 id 回读(用例给的 ref 只带标题和地址)。writing 没有这条
		// 读法,保持无正文 —— 不假装有。
		WikiRefs:         citedRefs(ctx, ownerID, bundle.WikiRefs, wikiBody(d.Corpus)),
		OutputRefs:       citedRefs(ctx, ownerID, bundle.OutputRefs, outputBody(d.Corpus)),
		WritingRefs:      citedRefs(ctx, ownerID, bundle.WritingRefs, noBody),
		SubjectivityRefs: toSubjectivityRefs(bundle.SubjectivityRefs),
		GroundingRefs:    citedRefs(ctx, ownerID, bundle.GroundingRefs, noBody),
		Ghosts:           ghostsFor(ctx, d, ownerID, convID),
	}
}

// ghostsFor —— 这次对话打过的 ghost。取不到只记一行:正文不该因为旁证失败而打不开。
func ghostsFor(
	ctx context.Context, d *ConversationsDeps, ownerID, convID string,
) []ghostShownOut {
	rows, err := usecase.ListGhostsForConversation(ctx, &d.Ghosts, ownerID, convID)
	if err != nil {
		d.Log.Warn("transcript: list ghosts", "err", err, "conversation_id", convID)
		return []ghostShownOut{}
	}
	return toGhostsShown(rows)
}

// bodyOf —— 按 id 取正文。取不到当空串。
type bodyOf func(ctx context.Context, ownerID, id string) string

func noBody(context.Context, string, string) string { return "" }

func wikiBody(deps corpus.Deps) bodyOf {
	return func(ctx context.Context, ownerID, id string) string {
		w, err := deps.Wiki.GetByID(ctx, ownerID, id)
		if err != nil {
			return ""
		}
		return w.Body()
	}
}

func outputBody(deps corpus.Deps) bodyOf {
	return func(ctx context.Context, ownerID, id string) string {
		o, err := deps.Output.GetByID(ctx, ownerID, id)
		if err != nil {
			return ""
		}
		return o.Body()
	}
}

func citedRefs(
	ctx context.Context, ownerID string, refs []usecase.TitledRef, body bodyOf,
) []citedRefOut {
	out := make([]citedRefOut, 0, len(refs))
	for i := range refs {
		out = append(out, citedRefOut{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path,
			Body: body(ctx, ownerID, refs[i].ID),
		})
	}
	return out
}

func toSubjectivityRefs(refs []usecase.SubjectivityRef) []citedRefOut {
	out := make([]citedRefOut, 0, len(refs))
	for i := range refs {
		out = append(out, citedRefOut{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path, Body: refs[i].Body,
		})
	}
	return out
}

func summaryFromBundle(bundle *repo.ChatWithMessages) conversationOut {
	c := bundle.Chat
	return conversationOut{
		ID: c.ID, Mode: string(c.Mode), VisitorName: c.VisitorName,
		Turns: countVisitorTurns(bundle.Messages), CodeID: c.CodeID,
		StartedAt: c.StartedAt.Format(time.RFC3339),
		LastAt:    c.LastAt.Format(time.RFC3339),
	}
}

// countVisitorTurns —— turn 数从 dialog 派生(一条 visitor 消息 = 一轮),不存计数字段。
func countVisitorTurns(msgs []entity.Message) int32 {
	var n int32
	for i := range msgs {
		if msgs[i].Role == "visitor" {
			n++
		}
	}
	return n
}

func toConversationOut(s *repo.ChatSummary) conversationOut {
	return conversationOut{
		ID: s.ID, Mode: s.Mode, VisitorName: s.VisitorName,
		Turns: s.Turns, PrivateHits: s.PrivateHits, ClientIP: s.ClientIP,
		Sentiment: corpus.DeriveSentiment(s.Turns, s.PrivateHits, s.Mode),
		CodeID:    s.CodeID, CodeLabel: s.CodeLabel, CodeValue: s.CodeValue,
		StartedAt: s.StartedAt.Format(time.RFC3339),
		LastAt:    s.LastAt.Format(time.RFC3339),
	}
}

func toMessageOut(m *entity.Message) messageOut {
	return messageOut{
		ID: m.ID, Role: m.Role, Body: m.Body,
		CitedWikiIDs:         emptyIfNil(m.CitedWikiIDs),
		CitedWritingIDs:      emptyIfNil(m.CitedWritingIDs),
		CitedOutputIDs:       emptyIfNil(m.CitedOutputIDs),
		CitedSubjectivityIDs: emptyIfNil(m.CitedSubjectivityIDs),
		CreatedAt:            m.CreatedAt.Format(time.RFC3339),
	}
}

func emptyIfNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func toGhostsShown(rows []entity.Ghost) []ghostShownOut {
	out := make([]ghostShownOut, 0, len(rows))
	for i := range rows {
		s := &rows[i]
		v := ghostShownOut{
			ID: s.ID, GhostText: s.GhostText, Source: string(s.Source),
			TurnIndex: s.TurnIndex, ShownAt: s.ShownAt.Format(time.RFC3339),
			Accepted: s.Accepted(),
		}
		if s.AcceptedAt != nil {
			at := s.AcceptedAt.Format(time.RFC3339)
			v.AcceptedAt = &at
		}
		out = append(out, v)
	}
	return out
}
