// sessions.go —— POST /api/v1/sessions —— visitor session 颁发。
// 按 tier 分发：'code' 走 IssueCodeSession（访问码）、'public' 走
// IssuePublicSession（无码，public visibility 切片）。
// 鉴权：颁发不需要 token；后续 /messages 用返回的 session_token bearer。

package public

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// createSessionRequest —— POST /api/v1/sessions 入参。BYOAIKey 字段已删 ——
// browser 自己保管 key（IndexedDB Web Crypto wrap），不上传 server。
// BYOAIProvider 仅用来判 tier(带 provider → mode=byoai);provider 本身是
// visitor/session 的属性(前端 session-store + per-request cred),不落 conv 行。
type createSessionRequest struct {
	Mode          string `json:"mode"` // 'code' | 'public' | 'byoai'
	Code          string `json:"code,omitempty"`
	VisitorName   string `json:"visitor_name,omitempty"`
	VisitorEmail  string `json:"visitor_email,omitempty"` // 可选;进入时填的邮箱
	MemberID      string `json:"member_id,omitempty"`
	BYOAIProvider string `json:"byoai_provider,omitempty"`
	// CaptchaToken —— #169 兑换失败超阈值后,captcha 启用时靠它解锁(关闭时忽略)。
	CaptchaToken string `json:"captcha_token,omitempty"`
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
	SessionToken        string                   `json:"session_token"`
	ConversationID      string                   `json:"conversation_id"`
	Code                string                   `json:"code,omitempty"`
	MemberID            string                   `json:"member_id,omitempty"`
	CodeLabel           string                   `json:"code_label,omitempty"`
	VisitorName         string                   `json:"visitor_name,omitempty"`
	SystemPromptPersona string                   `json:"system_prompt_persona"`
	Members             []sessionMemberResp      `json:"members"`
	Capabilities        []capreg.CapabilityState `json:"capabilities"`
	ToolSpecs           []capreg.VisitorToolSpec `json:"tool_specs"`
	SystemPromptPartIDs []string                 `json:"system_prompt_part_ids"`
	// Ghosts —— H.13.b: code 创建时 owner 设的"刚进来可问什么"
	// 列表；前端 ghost text 拿第一条当初始 ghost。code-mode 之外都是空数组
	// (json 走 "ghosts": [])。
	Ghosts []string `json:"ghosts"`
	// DockButtons —— #109/#110 owner 在 role 上配的 ≤2 个 chat dock 按钮（已过滤 code-deny、
	// 解析出 title）。前端渲染成两个位的按钮；点击把 trigger 当访客消息发出。
	DockButtons []dockButtonResp `json:"dock_buttons"`
	Quota       sessionQuotaResp `json:"quota"`
	// OwnerCanEmail —— owner 已配通 mail connector。前端据此决定约成卡片要不要
	// 显"发确认邮件"那块(#122:没配就根本不渲染那张卡)。
	OwnerCanEmail bool `json:"owner_can_email"`
}

// dockButtonResp —— 一个可渲染的 dock 按钮：能力 id + 显示名（透传 MCP title）+ 触发词。
type dockButtonResp struct {
	CapabilityID string `json:"capability_id"`
	Title        string `json:"title"`
	Trigger      string `json:"trigger"`
}

// resolveDockButtons —— 冻下的 dock 配置 → 可渲染按钮：只保留能力仍在本 session 可用集里的
// （code-deny 的能力不在 caps → 其按钮不渲染，D2）；title 从对应 CapabilityState 透传。
func resolveDockButtons(
	cfg []access.DockButtonConfig, caps []capreg.CapabilityState,
) []dockButtonResp {
	title := capTitleMap(caps)
	out := make([]dockButtonResp, 0, len(cfg))
	for i := range cfg {
		t, ok := title[cfg[i].CapabilityID]
		if !ok {
			continue // 能力被 code deny / 本 session 没有 → 按钮不渲染
		}
		out = append(out, dockButtonResp{
			CapabilityID: cfg[i].CapabilityID, Title: t, Trigger: cfg[i].Trigger,
		})
	}
	return out
}

// capTitleMap —— capability id → title（dock 按钮解析 label 用）。
func capTitleMap(caps []capreg.CapabilityState) map[string]string {
	m := make(map[string]string, len(caps))
	for i := range caps {
		m[caps[i].ID] = caps[i].Title
	}
	return m
}

func (h *Handlers) createSession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		if res, ok := h.guardedIssueSession(w, r, &req); ok {
			writeCreateSession(r.Context(), h, w, &res)
		}
	}
}

type codeIntroRequest struct {
	Code         string `json:"code"`
	CaptchaToken string `json:"captcha_token,omitempty"`
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
		if res, ok := h.guardedIntro(w, r, &req); ok {
			writeCodeIntro(h.Log, w, &res)
		}
	}
}

func writeCodeIntro(
	log *slog.Logger, w http.ResponseWriter, res *conversation.CodeIntroResult,
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
	ctx context.Context, deps *conversation.VisitorSessionDeps,
	req *createSessionRequest, clientIP string,
) (conversation.IssueCodeSessionResult, error) {
	if pickMode(req) == "code" {
		return conversation.IssueCodeSession(ctx, deps, &conversation.IssueCodeSessionInput{
			Code:         req.Code,
			VisitorName:  req.VisitorName,
			VisitorEmail: req.VisitorEmail,
			MemberID:     req.MemberID,
			ClientIP:     clientIP,
		})
	}
	return conversation.IssuePublicSession(ctx, deps, &conversation.IssuePublicSessionInput{
		VisitorName:   req.VisitorName,
		VisitorEmail:  req.VisitorEmail,
		BYOAIProvider: req.BYOAIProvider,
		ClientIP:      clientIP,
	})
}

func toMemberResps(members []access.CodeMember) []sessionMemberResp {
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

// clientIP —— 访客来源 IP。chi.RealIP 已把 X-Forwarded-For 解到 RemoteAddr，
// 这里只去 port；裸 IP（dev/test）直接用。写 conversations.client_ip 给 owner
// 做 IP 感知 + 封禁用。
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
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
	ctx context.Context, h *Handlers,
	w http.ResponseWriter, res *conversation.IssueCodeSessionResult,
) {
	log, deps := h.Log, &h.Visitor
	canEmail := owner.CanEmailCodes(ctx,
		owner.MailStatusDeps{Proxy: h.MailStatus}, res.Session.Data.OwnerID)
	in := assembleInputFromSession(&res.Session.Data, res.Chat.ID)
	// 一次 walk 出三样(States/ToolSpecs/PromptPartIDs):分别调会把每个外置插件
	// 冷拨两遍,两个网络沙箱插件能把 /sessions 顶到 ~16s(超 e2e 15s 等待)。
	bundle := deps.AgentSkills.AssembleVisitorBundle(ctx, in)
	resp := createSessionResponse{
		SessionToken:        res.Session.Token,
		ConversationID:      res.Chat.ID,
		Code:                res.Code,
		MemberID:            res.MemberID,
		CodeLabel:           res.CodeLabel,
		VisitorName:         res.VisitorName,
		SystemPromptPersona: conversation.ComposeDynamicPersona(res.Session.Data.RoleSnapshot),
		Capabilities:        bundle.States,
		ToolSpecs:           bundle.ToolSpecs,
		SystemPromptPartIDs: bundle.PromptPartIDs,
		Ghosts:              nonNilStringSlice(res.Ghosts),
		Quota: sessionQuotaResp{
			MaxTurns:   res.Quota.MaxTurns,
			UsedTurns:  res.Quota.UsedTurns,
			MaxMembers: res.Quota.MaxMembers,
		},
		Members:       toMemberResps(res.Members),
		OwnerCanEmail: canEmail,
		DockButtons: resolveDockButtons(
			res.Session.Data.RoleSnapshot.DockButtons(), bundle.States,
		),
	}
	// session token 也落一份 HttpOnly cookie(bearer 之外的兜底:跨 tab / 活过刷新 /
	// SSR);Set-Cookie 必须在 WriteHeader 前。
	setVisitorSessionCookie(w, res.Session.Token, res.Session.Data.ExpiresAt, h.SecureCookie)
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
// capreg.AssembleInput；ConversationID 来自 res.Chat 不在 data
// 里。跟 dev /internal/test/visitor-capabilities 一致，让两处 capability
// shape 完全同源。
func assembleInputFromSession(
	data *session.VisitorSessionData, conversationID string,
) *capreg.AssembleInput {
	return &capreg.AssembleInput{
		RoleSnapshot:   data.RoleSnapshot,
		OwnerID:        data.OwnerID,
		Mode:           data.Mode,
		CodeID:         data.CodeID,
		Visitor:        data.Visitor,
		ConversationID: conversationID,
	}
}
