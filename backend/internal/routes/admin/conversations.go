// conversations.go —— GET /api/admin/conversations + transcript by id.
// list 返回摘要（id / tier / visitor / counts / code label）；transcript
// 返完整 messages 数组，admin 前端可以一次拉全。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// ConversationsDeps —— admin conversations handlers 依赖。
type ConversationsDeps struct {
	Chats  conversation.ConversationsDeps
	Ghosts conversation.GhostDeps
}

type convSummaryView struct {
	StartedAt   string  `json:"started_at"`
	LastAt      string  `json:"last_at"`
	CodeID      *string `json:"code_id,omitempty"`
	CodeLabel   *string `json:"code_label,omitempty"`
	CodeValue   *string `json:"code_value,omitempty"`
	ID          string  `json:"id"`
	Mode        string  `json:"mode"`
	VisitorName string  `json:"visitor_name"`
	Sentiment   string  `json:"sentiment"`
	ClientIP    string  `json:"client_ip"`
	Turns       int32   `json:"turns"`
	PrivateHits int32   `json:"private_hits"`
}

type convMessageView struct {
	CreatedAt            string   `json:"created_at"`
	ID                   string   `json:"id"`
	Role                 string   `json:"role"`
	Body                 string   `json:"body"`
	CitedWikiIDs         []string `json:"cited_wiki_ids"`
	CitedWritingIDs      []string `json:"cited_writing_ids"`
	CitedOutputIDs       []string `json:"cited_output_ids"`
	CitedSubjectivityIDs []string `json:"cited_subjectivity_ids"`
}

type titledRefView struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

// subjectivityRefView —— subjectivity_refs 的一条：带 body（{id,path,title,body}）。只有
// owner opt-in（show_as_source=true）的才会出现，body 非私有泄漏。
type subjectivityRefView struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
	Body  string `json:"body"`
}

type convTranscriptResp struct {
	Conversation     convSummaryView       `json:"conversation"`
	Messages         []convMessageView     `json:"messages"`
	WikiRefs         []titledRefView       `json:"wiki_refs"`
	WritingRefs      []titledRefView       `json:"writing_refs"`
	OutputRefs       []titledRefView       `json:"output_refs"`
	SubjectivityRefs []subjectivityRefView `json:"subjectivity_refs"`
	// H.13.e: per-turn ghost text 日志 (shown + 是否 Tab-accept)。
	// code-mode 对话才会有；其他 mode 永远空数组。
	Ghosts []ghostView `json:"ghosts"`
}

type ghostView struct {
	AcceptedAt *string `json:"accepted_at,omitempty"`
	ID         string  `json:"id"`
	GhostText  string  `json:"ghost_text"`
	Source     string  `json:"source"`
	ShownAt    string  `json:"shown_at"`
	TurnIndex  int32   `json:"turn_index"`
	Accepted   bool    `json:"accepted"`
}

// MountConversations 挂 /conversations 子路由。
func (h *Handlers) MountConversations(r chi.Router) {
	r.Get("/conversations", h.listConversations())
	r.Get("/conversations/{id}", h.getConversation())
	// ghost-steering telemetry: per-waypoint funnel (policy ghosts shown vs accepted).
	r.Get("/ghosts/telemetry", h.ghostTelemetry())
}

func (h *Handlers) listConversations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		limit := parseConvLimit(r.URL.Query().Get("limit"))
		rows, err := conversation.ListConversations(
			r.Context(), h.Conversations.Chats, ownerID, limit,
		)
		if err != nil {
			h.Log.Error("list conversations", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeConvList(h.Log, w, rows)
	}
}

func (h *Handlers) getConversation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchGetConversation(h, w, r)
	}
}

func dispatchGetConversation(h *Handlers, w http.ResponseWriter, r *http.Request) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	convID := chi.URLParam(r, "id")
	out, err := conversation.GetConversationTranscript(
		r.Context(), h.Conversations.Chats, ownerID, convID,
	)
	if err != nil {
		handleConvErr(h.Log, w, err)
		return
	}
	ghosts := loadGhostsForAdmin(h, r, ownerID, convID)
	writeTranscript(h.Log, w, &out, ghosts)
}

// loadGhostsForAdmin —— ghosts 没必要阻塞 transcript；DB 报错
// 返空数组、记一行日志让 admin 自己排。
func loadGhostsForAdmin(
	h *Handlers, r *http.Request, ownerID, convID string,
) []conversation.Ghost {
	rows, err := conversation.ListGhostsForConversation(
		r.Context(), &h.Conversations.Ghosts, ownerID, convID,
	)
	if err != nil {
		h.Log.Warn("list ghosts for transcript", logErrKey, err)
		return []conversation.Ghost{}
	}
	return rows
}

func handleConvErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, conversation.ErrChatNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "not_found", Message: "conversation not found",
		})
		return
	}
	log.Error("get conversation transcript", logErrKey, err)
	writeError(log, w, serverErr())
}

func writeConvList(log *slog.Logger, w http.ResponseWriter, rows []conversation.ChatSummary) {
	items := make([]convSummaryView, 0, len(rows))
	for i := range rows {
		items = append(items, toConvSummaryView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode conv list", logErrKey, err)
	}
}

func writeTranscript(
	log *slog.Logger, w http.ResponseWriter, t *conversation.TranscriptBundle,
	ghosts []conversation.Ghost,
) {
	conv := bundleSummary(&t.ConvBundle)
	msgs := make([]convMessageView, 0, len(t.ConvBundle.Messages))
	for i := range t.ConvBundle.Messages {
		msgs = append(msgs, toConvMessageView(&t.ConvBundle.Messages[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(convTranscriptResp{
		Conversation:     conv,
		Messages:         msgs,
		WikiRefs:         toRefViews(t.WikiRefs),
		WritingRefs:      toRefViews(t.WritingRefs),
		OutputRefs:       toRefViews(t.OutputRefs),
		SubjectivityRefs: toSubjectivityRefViews(t.SubjectivityRefs),
		Ghosts:           toGhostViews(ghosts),
	}); err != nil {
		log.Error("encode conv transcript", logErrKey, err)
	}
}

func toGhostViews(rows []conversation.Ghost) []ghostView {
	out := make([]ghostView, 0, len(rows))
	for i := range rows {
		out = append(out, toGhostView(&rows[i]))
	}
	return out
}

func toGhostView(s *conversation.Ghost) ghostView {
	v := ghostView{
		ID:        s.ID,
		GhostText: s.GhostText,
		Source:    string(s.Source),
		TurnIndex: s.TurnIndex,
		ShownAt:   s.ShownAt.Format(time.RFC3339),
		Accepted:  s.Accepted(),
	}
	if s.AcceptedAt != nil {
		a := s.AcceptedAt.Format(time.RFC3339)
		v.AcceptedAt = &a
	}
	return v
}

func toRefViews(refs []conversation.TitledRef) []titledRefView {
	out := make([]titledRefView, 0, len(refs))
	for i := range refs {
		out = append(out, titledRefView{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path,
		})
	}
	return out
}

func toSubjectivityRefViews(refs []conversation.SubjectivityRef) []subjectivityRefView {
	out := make([]subjectivityRefView, 0, len(refs))
	for i := range refs {
		out = append(out, subjectivityRefView{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path, Body: refs[i].Body,
		})
	}
	return out
}

func bundleSummary(bundle *conversation.ChatWithMessages) convSummaryView {
	c := bundle.Chat
	return convSummaryView{
		ID:          c.ID,
		Mode:        string(c.Mode),
		VisitorName: c.VisitorName,
		Turns:       countVisitorTurns(bundle.Messages),
		CodeID:      c.CodeID,
		StartedAt:   c.StartedAt.Format(time.RFC3339),
		LastAt:      c.LastAt.Format(time.RFC3339),
	}
}

// countVisitorTurns —— 从 messages 派生 turn 数:一个 dialog 一条 visitor 消息。
// count 一律从 dialog 派生,不存计数字段。
func countVisitorTurns(msgs []conversation.Message) int32 {
	var n int32
	for i := range msgs {
		if msgs[i].Role == "visitor" {
			n++
		}
	}
	return n
}

func toConvSummaryView(s *conversation.ChatSummary) convSummaryView {
	return convSummaryView{
		ID:          s.ID,
		Mode:        s.Mode,
		VisitorName: s.VisitorName,
		Turns:       s.Turns,
		PrivateHits: s.PrivateHits,
		ClientIP:    s.ClientIP,
		Sentiment:   corpus.DeriveSentiment(s.Turns, s.PrivateHits, s.Mode),
		CodeID:      s.CodeID,
		CodeLabel:   s.CodeLabel,
		CodeValue:   s.CodeValue,
		StartedAt:   s.StartedAt.Format(time.RFC3339),
		LastAt:      s.LastAt.Format(time.RFC3339),
	}
}

func toConvMessageView(m *conversation.Message) convMessageView {
	return convMessageView{
		ID:                   m.ID,
		Role:                 m.Role,
		Body:                 m.Body,
		CitedWikiIDs:         ensureSlice(m.CitedWikiIDs),
		CitedWritingIDs:      ensureSlice(m.CitedWritingIDs),
		CitedOutputIDs:       ensureSlice(m.CitedOutputIDs),
		CitedSubjectivityIDs: ensureSlice(m.CitedSubjectivityIDs),
		CreatedAt:            m.CreatedAt.Format(time.RFC3339),
	}
}

const (
	limitParseBase  = 10
	limitParseWidth = 32
)

// parseConvLimit 解析 ?limit=N；用 strconv.ParseInt 直接拿 int32 避开
// gosec G109 (int → int32 收窄报警)。usecase 层会 clamp 上下界。
func parseConvLimit(s string) int32 {
	n, err := strconv.ParseInt(s, limitParseBase, limitParseWidth)
	if err != nil || n <= 0 {
		return 0
	}
	return int32(n)
}
