// sessions.go —— POST /api/v1/sessions —— visitor session 颁发。
// 按 tier 分发：'code' 走 IssueCodeSession（访问码）、'public' 走
// IssuePublicSession（无码，public visibility 切片）。
// 鉴权：颁发不需要 token；后续 /messages 用返回的 session_token bearer。

package public

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// createSessionRequest —— POST /api/v1/sessions 入参。BYOAIKey 字段已删 ——
// browser 自己保管 key（IndexedDB Web Crypto wrap），不上传 server。
// BYOAIProvider 还在：一次性写到 conversation 表当 audit log，session
// 不缓存。
type createSessionRequest struct {
	Tier          string `json:"tier"` // 'code' | 'public' | 'byoai'
	Code          string `json:"code,omitempty"`
	VisitorName   string `json:"visitor_name,omitempty"`
	BYOAIProvider string `json:"byoai_provider,omitempty"`
}

type createSessionResponse struct {
	SessionToken   string `json:"session_token"`
	ConversationID string `json:"conversation_id"`
}

func (h *Handlers) createSession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		res, err := dispatchIssueSession(r.Context(), &h.Visitor, &req)
		if err != nil {
			handleVisitorErr(h.Log, w, err)
			return
		}
		writeCreateSession(h.Log, w, &res.Session, &res.Conversation)
	}
}

// dispatchIssueSession 按 tier 派发到对应 usecase。
// tier=='code' → IssueCodeSession（带 access code）。
// tier=='public' / 'byoai' / 空 → IssuePublicSession，BYOAI 字段透传到 session data。
func dispatchIssueSession(
	ctx context.Context, deps *usecases.VisitorDeps, req *createSessionRequest,
) (usecases.IssueCodeSessionResult, error) {
	if pickTier(req) == "code" {
		return usecases.IssueCodeSession(ctx, deps, &usecases.IssueCodeSessionInput{
			Code:        req.Code,
			VisitorName: req.VisitorName,
		})
	}
	return usecases.IssuePublicSession(ctx, deps, &usecases.IssuePublicSessionInput{
		VisitorName:   req.VisitorName,
		BYOAIProvider: req.BYOAIProvider,
	})
}

func pickTier(req *createSessionRequest) string {
	if req.Tier != "" {
		return req.Tier
	}
	if req.Code != "" {
		return "code"
	}
	return "public"
}

func writeCreateSession(
	log *slog.Logger, w http.ResponseWriter,
	issued *session.IssuedVisitor, conv *domain.Conversation,
) {
	resp := createSessionResponse{
		SessionToken:   issued.Token,
		ConversationID: conv.ID,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode session resp", "err", err)
	}
}
