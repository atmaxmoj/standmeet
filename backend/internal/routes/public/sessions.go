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

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// createSessionRequest —— POST /api/v1/sessions 入参。BYOAIKey 字段已删 ——
// browser 自己保管 key（IndexedDB Web Crypto wrap），不上传 server。
// BYOAIProvider 还在：一次性写到 conversation 表当 audit log，session
// 不缓存。
type createSessionRequest struct {
	Mode          string `json:"mode"` // 'code' | 'public' | 'byoai'
	Code          string `json:"code,omitempty"`
	VisitorName   string `json:"visitor_name,omitempty"`
	MemberID      string `json:"member_id,omitempty"`
	BYOAIProvider string `json:"byoai_provider,omitempty"`
}

type sessionQuotaResp struct {
	MaxTurns   int32 `json:"max_turns"`
	UsedTurns  int32 `json:"used_turns"`
	MaxMembers int32 `json:"max_members"`
}

type sessionMemberResp struct {
	Name     string `json:"name"`
	LastSeen string `json:"last_seen"`
}

type createSessionResponse struct {
	SessionToken        string                        `json:"session_token"`
	ConversationID      string                        `json:"conversation_id"`
	Code                string                        `json:"code,omitempty"`
	MemberID            string                        `json:"member_id,omitempty"`
	CodeLabel           string                        `json:"code_label,omitempty"`
	VisitorName         string                        `json:"visitor_name,omitempty"`
	SystemPromptPersona string                        `json:"system_prompt_persona"`
	Members             []sessionMemberResp           `json:"members"`
	Capabilities        []agentskills.CapabilityState `json:"capabilities"`
	ToolSpecs           []agentskills.VisitorToolSpec `json:"tool_specs"`
	SystemPromptPartIDs []string                      `json:"system_prompt_part_ids"`
	// Ghosts —— H.13.b: code 创建时 owner 设的"刚进来可问什么"
	// 列表；前端 ghost text 拿第一条当初始 ghost。code-mode 之外都是空数组
	// (json 走 "ghosts": [])。
	Ghosts []string         `json:"ghosts"`
	Quota  sessionQuotaResp `json:"quota"`
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
		writeCreateSession(r.Context(), h.Log, &h.Visitor, w, &res)
	}
}

type codeIntroRequest struct {
	Code string `json:"code"`
}

type codeIntroResponse struct {
	Label       string `json:"label"`
	Greeting    string `json:"greeting"`
	MaxMembers  int32  `json:"max_members"`
	MemberCount int32  `json:"member_count"`
}

// codeIntro —— 名字选择器 pre-issue peek:code(走 body)→ greeting + 名字上限/
// 已用。code 无效 → handleVisitorErr(code_invalid),前端优雅回落(不显 intro)。
func (h *Handlers) codeIntro() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req codeIntroRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		res, err := usecases.CodeIntro(r.Context(), &h.Visitor, req.Code)
		if err != nil {
			handleVisitorErr(h.Log, w, err)
			return
		}
		writeCodeIntro(h.Log, w, &res)
	}
}

func writeCodeIntro(
	log *slog.Logger, w http.ResponseWriter, res *usecases.CodeIntroResult,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := codeIntroResponse{
		Label: res.Label, Greeting: res.Greeting,
		MaxMembers: res.MaxMembers, MemberCount: res.MemberCount,
	}
	if eerr := json.NewEncoder(w).Encode(resp); eerr != nil {
		log.Error("encode code intro", "err", eerr)
	}
}

// dispatchIssueSession 按 tier 派发到对应 usecase。
// tier=='code' → IssueCodeSession（带 access code）。
// mode=='public' / 'byoai' / 空 → IssuePublicSession，BYOAI 字段透传到 session data。
func dispatchIssueSession(
	ctx context.Context, deps *usecases.VisitorDeps, req *createSessionRequest,
) (usecases.IssueCodeSessionResult, error) {
	if pickMode(req) == "code" {
		return usecases.IssueCodeSession(ctx, deps, &usecases.IssueCodeSessionInput{
			Code:        req.Code,
			VisitorName: req.VisitorName,
			MemberID:    req.MemberID,
		})
	}
	return usecases.IssuePublicSession(ctx, deps, &usecases.IssuePublicSessionInput{
		VisitorName:   req.VisitorName,
		BYOAIProvider: req.BYOAIProvider,
	})
}

func toMemberResps(members []domain.CodeMember) []sessionMemberResp {
	if len(members) == 0 {
		return []sessionMemberResp{}
	}
	out := make([]sessionMemberResp, 0, len(members))
	for i := range members {
		out = append(out, sessionMemberResp{
			Name:     members[i].DisplayName,
			LastSeen: members[i].LastSeenAt.UTC().Format("2006-01-02"),
		})
	}
	return out
}

func pickMode(req *createSessionRequest) string {
	if req.Mode != "" {
		return req.Mode
	}
	if req.Code != "" {
		return "code"
	}
	return "public"
}

func writeCreateSession(
	ctx context.Context, log *slog.Logger, deps *usecases.VisitorDeps,
	w http.ResponseWriter, res *usecases.IssueCodeSessionResult,
) {
	in := assembleInputFromSession(&res.Session.Data, res.Chat.ID)
	resp := createSessionResponse{
		SessionToken:        res.Session.Token,
		ConversationID:      res.Chat.ID,
		Code:                res.Code,
		MemberID:            res.MemberID,
		CodeLabel:           res.CodeLabel,
		VisitorName:         res.VisitorName,
		SystemPromptPersona: usecases.ComposeDynamicPersona(res.Session.Data.RoleSnapshot),
		Capabilities:        deps.AgentSkills.VisitorStates(ctx, in),
		ToolSpecs:           deps.AgentSkills.VisitorToolSpecs(ctx, in),
		SystemPromptPartIDs: deps.AgentSkills.VisitorPromptPartIDs(ctx, in),
		Ghosts:              nonNilStringSlice(res.Ghosts),
		Quota: sessionQuotaResp{
			MaxTurns:   res.Quota.MaxTurns,
			UsedTurns:  res.Quota.UsedTurns,
			MaxMembers: res.Quota.MaxMembers,
		},
		Members: toMemberResps(res.Members),
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode session resp", "err", err)
	}
}

// nonNilStringSlice —— wire JSON 上 `ghosts: null` 跟 `[]`
// 对前端是不同 case；nil 强转 [] 保证浏览器永远拿到 array (project
// principle: 空容器不 nil)。
func nonNilStringSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// assembleInputFromSession —— 把 freshly issued VisitorSessionData 折成
// agentskills.AssembleInput；ConversationID 来自 res.Chat 不在 data
// 里。跟 dev /internal/test/visitor-capabilities 一致，让两处 capability
// shape 完全同源。
func assembleInputFromSession(
	data *session.VisitorSessionData, conversationID string,
) *agentskills.AssembleInput {
	return &agentskills.AssembleInput{
		RoleSnapshot:   data.RoleSnapshot,
		MaxBookings:    data.MaxBookings,
		OwnerID:        data.OwnerID,
		Mode:           data.Mode,
		CodeID:         data.CodeID,
		VisitorName:    data.VisitorName,
		ConversationID: conversationID,
	}
}
