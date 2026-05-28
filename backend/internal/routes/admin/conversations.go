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

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// ConversationsDeps —— admin conversations handlers 依赖。
type ConversationsDeps struct {
	Conv usecases.ConversationsDeps
}

type convSummaryView struct {
	StartedAt    string  `json:"started_at"`
	LastAt       string  `json:"last_at"`
	CodeID       *string `json:"code_id,omitempty"`
	CodeLabel    *string `json:"code_label,omitempty"`
	CodeValue    *string `json:"code_value,omitempty"`
	ID           string  `json:"id"`
	Mode         string  `json:"mode"`
	VisitorName  string  `json:"visitor_name"`
	Sentiment    string  `json:"sentiment"`
	MessageCount int32   `json:"message_count"`
	PrivateHits  int32   `json:"private_hits"`
}

type convMessageView struct {
	CreatedAt      string   `json:"created_at"`
	ID             string   `json:"id"`
	Role           string   `json:"role"`
	Body           string   `json:"body"`
	CitedWikiIDs   []string `json:"cited_wiki_ids"`
	CitedOutputIDs []string `json:"cited_output_ids"`
}

type titledRefView struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

type convTranscriptResp struct {
	Conversation convSummaryView   `json:"conversation"`
	Messages     []convMessageView `json:"messages"`
	WikiRefs     []titledRefView   `json:"wiki_refs"`
	OutputRefs   []titledRefView   `json:"output_refs"`
}

// MountConversations 挂 /conversations 子路由。
func (h *Handlers) MountConversations(r chi.Router) {
	r.Get("/conversations", h.listConversations())
	r.Get("/conversations/{id}", h.getConversation())
}

func (h *Handlers) listConversations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		limit := parseConvLimit(r.URL.Query().Get("limit"))
		rows, err := usecases.ListConversations(r.Context(), h.Conversations.Conv, ownerID, limit)
		if err != nil {
			h.Log.Error("list conversations", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeConvList(h.Log, w, rows)
	}
}

func (h *Handlers) getConversation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		convID := chi.URLParam(r, "id")
		out, err := usecases.GetConversationTranscript(
			r.Context(), h.Conversations.Conv, ownerID, convID,
		)
		if err != nil {
			handleConvErr(h.Log, w, err)
			return
		}
		writeTranscript(h.Log, w, &out)
	}
}

func handleConvErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrConversationNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "not_found", Message: "conversation not found",
		})
		return
	}
	log.Error("get conversation transcript", "err", err)
	writeError(log, w, serverErr())
}

func writeConvList(log *slog.Logger, w http.ResponseWriter, rows []postgres.ConvSummary) {
	items := make([]convSummaryView, 0, len(rows))
	for i := range rows {
		items = append(items, toConvSummaryView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode conv list", "err", err)
	}
}

func writeTranscript(
	log *slog.Logger, w http.ResponseWriter, t *usecases.TranscriptBundle,
) {
	conv := bundleSummary(&t.ConvBundle)
	msgs := make([]convMessageView, 0, len(t.ConvBundle.Messages))
	for i := range t.ConvBundle.Messages {
		msgs = append(msgs, toConvMessageView(&t.ConvBundle.Messages[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(convTranscriptResp{
		Conversation: conv,
		Messages:     msgs,
		WikiRefs:     toRefViews(t.WikiRefs),
		OutputRefs:   toRefViews(t.OutputRefs),
	}); err != nil {
		log.Error("encode conv transcript", "err", err)
	}
}

func toRefViews(refs []usecases.TitledRef) []titledRefView {
	out := make([]titledRefView, 0, len(refs))
	for i := range refs {
		out = append(out, titledRefView{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path,
		})
	}
	return out
}

func bundleSummary(bundle *postgres.ConversationWithMessages) convSummaryView {
	c := bundle.Conversation
	return convSummaryView{
		ID:           c.ID,
		Mode:         c.Mode,
		VisitorName:  c.VisitorName,
		MessageCount: c.MessageCount,
		CodeID:       c.CodeID,
		StartedAt:    c.StartedAt.Format(time.RFC3339),
		LastAt:       c.LastAt.Format(time.RFC3339),
	}
}

func toConvSummaryView(s *postgres.ConvSummary) convSummaryView {
	return convSummaryView{
		ID:           s.ID,
		Mode:         s.Mode,
		VisitorName:  s.VisitorName,
		MessageCount: s.MessageCount,
		PrivateHits:  s.PrivateHits,
		Sentiment:    usecases.DeriveSentiment(s.MessageCount, s.PrivateHits, s.Mode),
		CodeID:       s.CodeID,
		CodeLabel:    s.CodeLabel,
		CodeValue:    s.CodeValue,
		StartedAt:    s.StartedAt.Format(time.RFC3339),
		LastAt:       s.LastAt.Format(time.RFC3339),
	}
}

func toConvMessageView(m *domain.Message) convMessageView {
	return convMessageView{
		ID:             m.ID,
		Role:           m.Role,
		Body:           m.Body,
		CitedWikiIDs:   ensureSlice(m.CitedWikiIDs),
		CitedOutputIDs: ensureSlice(m.CitedOutputIDs),
		CreatedAt:      m.CreatedAt.Format(time.RFC3339),
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
