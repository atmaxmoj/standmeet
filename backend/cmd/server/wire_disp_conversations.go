// wire_disp_conversations.go —— conversation 域 → 出站收口的窄口。
//
// 这里只做**映射**:域实体 → 收口声明的那些类型(形状在 res_conversations_shape.go)。
// 两处是这里做的、收口不该知道的:ghost 日志和被引条目的正文都是 best-effort ——
// 它们是旁证,取不到不该让整份逐字稿失败。

package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

func newConversationOps(d *runtimeDeps) conversationOps {
	corpusDeps := corpusDepsOf(d)
	return conversationOps{
		chats: conversation.ConversationsDeps{
			Chats: d.chatRepo, Wiki: d.wikiRepo, Writing: d.writingRepo,
			Output:       d.outputRepo,
			Subjectivity: corpus.NewSubjectivityCiteResolver(d.subjectivityRepo),
		},
		ghosts:     conversation.GhostDeps{Repo: d.ghostRepo},
		corpusDeps: &corpusDeps,
		log:        d.log,
	}
}

type conversationOps struct {
	chats      conversation.ConversationsDeps
	ghosts     conversation.GhostDeps
	corpusDeps *corpus.Deps
	log        *slog.Logger
}

func (a conversationOps) List(
	ctx context.Context, ownerID string, limit int32,
) ([]dispatcher.Conversation, error) {
	rows, err := conversation.ListConversations(ctx, a.chats, ownerID, limit)
	if err != nil {
		return nil, convErr(err)
	}
	out := make([]dispatcher.Conversation, 0, len(rows))
	for i := range rows {
		out = append(out, toDispatcherConversation(&rows[i]))
	}
	return out, nil
}

func (a conversationOps) Transcript(
	ctx context.Context, ownerID, convID string,
) (dispatcher.Transcript, error) {
	bundle, err := conversation.GetConversationTranscript(ctx, a.chats, ownerID, convID)
	if err != nil {
		return dispatcher.Transcript{}, convErr(err)
	}
	msgs := make([]dispatcher.TranscriptMessage, 0, len(bundle.ConvBundle.Messages))
	for i := range bundle.ConvBundle.Messages {
		msgs = append(msgs, toDispatcherMessage(&bundle.ConvBundle.Messages[i]))
	}
	return dispatcher.Transcript{
		Conversation: summaryFromBundle(&bundle.ConvBundle),
		Messages:     msgs,
		// wiki / output 的正文按 id 回读(域给的 ref 只带标题和地址)。writing 没有这条读法,
		// 保持无正文 —— 不假装有。
		WikiRefs:         a.refs(ctx, ownerID, bundle.WikiRefs, a.wikiBody),
		OutputRefs:       a.refs(ctx, ownerID, bundle.OutputRefs, a.outputBody),
		WritingRefs:      a.refs(ctx, ownerID, bundle.WritingRefs, noBody),
		SubjectivityRefs: toSubjectivityRefs(bundle.SubjectivityRefs),
		Ghosts:           a.ghostsFor(ctx, ownerID, convID),
	}, nil
}

func (a conversationOps) GhostTelemetry(
	ctx context.Context, ownerID string,
) (dispatcher.GhostFunnel, error) {
	stats, err := conversation.GhostTelemetry(ctx, &a.ghosts, ownerID)
	if err != nil {
		return dispatcher.GhostFunnel{}, convErr(err)
	}
	return toGhostFunnel(stats), nil
}

// ghostsFor —— 这次对话打过的 ghost。取不到只记一行:正文不该因为旁证失败而打不开。
func (a conversationOps) ghostsFor(
	ctx context.Context, ownerID, convID string,
) []dispatcher.GhostShown {
	rows, err := conversation.ListGhostsForConversation(ctx, &a.ghosts, ownerID, convID)
	if err != nil {
		a.log.Warn("transcript: list ghosts", "err", err, "conversation_id", convID)
		return []dispatcher.GhostShown{}
	}
	return toGhostsShown(rows)
}

// bodyOf —— 按 id 取正文。取不到当空串。
type bodyOf func(ctx context.Context, ownerID, id string) string

func noBody(context.Context, string, string) string { return "" }

func (a conversationOps) wikiBody(ctx context.Context, ownerID, id string) string {
	w, err := a.corpusDeps.Wiki.GetByID(ctx, ownerID, id)
	if err != nil {
		return ""
	}
	return w.Body()
}

func (a conversationOps) outputBody(ctx context.Context, ownerID, id string) string {
	o, err := a.corpusDeps.Output.GetByID(ctx, ownerID, id)
	if err != nil {
		return ""
	}
	return o.Body()
}

func (conversationOps) refs(
	ctx context.Context, ownerID string, refs []conversation.TitledRef, body bodyOf,
) []dispatcher.CitedRef {
	out := make([]dispatcher.CitedRef, 0, len(refs))
	for i := range refs {
		out = append(out, dispatcher.CitedRef{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path,
			Body: body(ctx, ownerID, refs[i].ID),
		})
	}
	return out
}

func toSubjectivityRefs(refs []conversation.SubjectivityRef) []dispatcher.CitedRef {
	out := make([]dispatcher.CitedRef, 0, len(refs))
	for i := range refs {
		out = append(out, dispatcher.CitedRef{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path, Body: refs[i].Body,
		})
	}
	return out
}

func summaryFromBundle(bundle *conversation.ChatWithMessages) dispatcher.Conversation {
	c := bundle.Chat
	return dispatcher.Conversation{
		ID: c.ID, Mode: string(c.Mode), VisitorName: c.VisitorName,
		Turns: countVisitorTurns(bundle.Messages), CodeID: c.CodeID,
		StartedAt: c.StartedAt.Format(time.RFC3339),
		LastAt:    c.LastAt.Format(time.RFC3339),
	}
}

// countVisitorTurns —— turn 数从 dialog 派生(一条 visitor 消息 = 一轮),不存计数字段。
func countVisitorTurns(msgs []conversation.Message) int32 {
	var n int32
	for i := range msgs {
		if msgs[i].Role == "visitor" {
			n++
		}
	}
	return n
}

func toDispatcherConversation(s *conversation.ChatSummary) dispatcher.Conversation {
	return dispatcher.Conversation{
		ID: s.ID, Mode: s.Mode, VisitorName: s.VisitorName,
		Turns: s.Turns, PrivateHits: s.PrivateHits, ClientIP: s.ClientIP,
		Sentiment: corpus.DeriveSentiment(s.Turns, s.PrivateHits, s.Mode),
		CodeID:    s.CodeID, CodeLabel: s.CodeLabel, CodeValue: s.CodeValue,
		StartedAt: s.StartedAt.Format(time.RFC3339),
		LastAt:    s.LastAt.Format(time.RFC3339),
	}
}

func toDispatcherMessage(m *conversation.Message) dispatcher.TranscriptMessage {
	return dispatcher.TranscriptMessage{
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

func toGhostsShown(rows []conversation.Ghost) []dispatcher.GhostShown {
	out := make([]dispatcher.GhostShown, 0, len(rows))
	for i := range rows {
		s := &rows[i]
		v := dispatcher.GhostShown{
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

func toGhostFunnel(stats []conversation.GhostWaypointStat) dispatcher.GhostFunnel {
	wps := make([]dispatcher.WaypointFunnel, 0, len(stats))
	var shown, accepted int64
	for i := range stats {
		s := &stats[i]
		wps = append(wps, dispatcher.WaypointFunnel{
			TargetWaypoint: s.TargetWaypoint, Shown: s.Shown,
			Accepted: s.Accepted, AcceptanceRate: s.AcceptanceRate(),
		})
		shown += s.Shown
		accepted += s.Accepted
	}
	totals := dispatcher.FunnelTotals{Shown: shown, Accepted: accepted}
	if shown > 0 {
		totals.AcceptanceRate = float64(accepted) / float64(shown)
	}
	return dispatcher.GhostFunnel{Waypoints: wps, Totals: totals}
}

func convErr(err error) error {
	if err == nil {
		return nil
	}
	for _, c := range convErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fmt.Errorf("conversation op: %w", err)
}

var convErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{conversation.ErrChatNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("conversation not found"), "not_found")
	}},
}

// 编译期确认:适配器满足收口声明的那个窄口。
var _ dispatcher.ConversationStore = conversationOps{}
