// sessions.go —— POST /api/v1/sessions —— visitor session issuance. Dispatched by tier:
// 'code' → IssueCodeSession (access code), 'public' → IssuePublicSession (no code,
// public-visibility slice). Needs no token; later /messages calls bear session_token.

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// createSessionRequest —— input for POST /api/v1/sessions. BYOAIKey was removed — the
// browser holds the key (IndexedDB Web Crypto wrap), never uploaded. BYOAIProvider only
// decides tier (present → mode=byoai); the provider is a property of the visitor/session
// (frontend store + per-request cred), never landed on a row.
type createSessionRequest struct {
	Mode          string `json:"mode"` // 'code' | 'public' | 'byoai'
	Code          string `json:"code,omitempty"`
	VisitorName   string `json:"visitor_name,omitempty"`
	VisitorEmail  string `json:"visitor_email,omitempty"` // optional; the email filled in on entry
	MemberID      string `json:"member_id,omitempty"`
	BYOAIProvider string `json:"byoai_provider,omitempty"`
	// CaptchaToken —— #169: unlocks access once redemption failures pass the threshold,
	// when captcha is enabled (ignored when off).
	CaptchaToken string `json:"captcha_token,omitempty"`
	// EmbedToken —— widget's EdDSA JWT credential (anti-theft): server verifies the
	// signature and looks the code up from it, so plaintext code is never carried.
	// See [[embed-credential-never-carries-the-code]].
	EmbedToken string `json:"embed_token,omitempty"`
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
	SessionToken   string `json:"session_token"`
	ConversationID string `json:"conversation_id"`
	Code           string `json:"code,omitempty"`
	MemberID       string `json:"member_id,omitempty"`
	CodeLabel      string `json:"code_label,omitempty"`
	VisitorName    string `json:"visitor_name,omitempty"`
	// MicrositeSlug —— page this code opens when scanned. Empty = default conversation;
	// always sent (never omitempty) since missing vs. genuinely-empty must stay distinct.
	MicrositeSlug       string                   `json:"microsite_slug"`
	SystemPromptPersona string                   `json:"system_prompt_persona"`
	Members             []sessionMemberResp      `json:"members"`
	Capabilities        []capreg.CapabilityState `json:"capabilities"`
	ToolSpecs           []capreg.VisitorToolSpec `json:"tool_specs"`
	SystemPromptPartIDs []string                 `json:"system_prompt_part_ids"`
	// Ghosts —— H.13.b: owner's "what to ask when you first arrive" list; frontend's
	// ghost text takes the first entry. Empty array outside code mode ("ghosts": []).
	Ghosts []string `json:"ghosts"`
	// DockButtons —— #109/#110: up to 2 chat dock buttons from the role config
	// (code-deny filtered, title resolved); clicking one sends trigger as a message.
	DockButtons []dockButtonResp `json:"dock_buttons"`
	Quota       sessionQuotaResp `json:"quota"`
	// OwnerCanDeliver —— whether the owner has a usable outbound channel; gates the
	// booking-confirmed card's "send confirmation email" section (#122: else hidden).
	OwnerCanDeliver bool `json:"owner_can_deliver"`
}

// dockButtonResp —— one renderable dock button: capability id + display name (from
// MCP title) + trigger phrase.
type dockButtonResp struct {
	CapabilityID string `json:"capability_id"`
	Title        string `json:"title"`
	Trigger      string `json:"trigger"`
}

// resolveDockButtons —— frozen dock config → renderable buttons: keeps only
// capabilities still in this session's available set (code-denied → absent from caps →
// button doesn't render, D2); title passes through from the matching CapabilityState.
func resolveDockButtons(
	cfg []access.DockButtonConfig, caps []capreg.CapabilityState,
) []dockButtonResp {
	title := capTitleMap(caps)
	out := make([]dockButtonResp, 0, len(cfg))
	for i := range cfg {
		t, ok := title[cfg[i].CapabilityID]
		if !ok {
			continue // capability is code-denied / absent from this session → button doesn't render
		}
		out = append(out, dockButtonResp{
			CapabilityID: cfg[i].CapabilityID, Title: t, Trigger: cfg[i].Trigger,
		})
	}
	return out
}

// capTitleMap —— capability id → title (used to resolve dock button labels).
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
	Label    string `json:"label"`
	Greeting string `json:"greeting"`
	// MicrositeSlug —— which page this code opens. Empty string means the default
	// conversation, not "no answer".
	MicrositeSlug string `json:"microsite_slug"`
	MaxMembers    int32  `json:"max_members"`
	MemberCount   int32  `json:"member_count"`
}

// codeIntro —— name picker's pre-issue peek: code (in body) → greeting + name cap/used.
// Invalid code → handleVisitorErr(code_invalid); frontend falls back (no intro shown).
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
		MicrositeSlug: res.MicrositeSlug,
		MaxMembers:    res.MaxMembers, MemberCount: res.MemberCount,
	}
	if eerr := json.NewEncoder(w).Encode(resp); eerr != nil {
		log.Error("encode code intro", "err", eerr)
	}
}

// OpenCodeSession —— trades a code for a session, and hands back the already-assembled
// capability input. Lives here because this file runs every "code → session" exchange
// in this instance; the visitor MCP face (mcp_visitor.go) wants the same thing, differing
// only in transport (Authorization header, no HTTP body) — writing it twice would let
// quota, member resolution, and failure wording drift apart. Nil return means it never
// opened; the envelope carries the message for the other side, via visitorErrCases.
func (h *Handlers) OpenCodeSession(
	ctx context.Context, code, visitorName, ip string,
) (OpenedCodeSession, apierr.Envelope) {
	res, err := conversation.IssueCodeSession(ctx, &h.Visitor,
		&conversation.IssueCodeSessionInput{
			Code: code, VisitorName: visitorName, ClientIP: ip,
		})
	if err != nil {
		h.recordVisitorMCPFail(ctx, ip, err)
		return OpenedCodeSession{}, apierr.Classify(err, visitorErrCases)
	}
	h.CodeGuard.Reset(ctx, ip)
	return OpenedCodeSession{
		In:     assembleInputFromSession(&res.Session.Data, res.Chat.ID),
		ConvID: res.Chat.ID,
	}, apierr.Envelope{}
}

// OpenedCodeSession —— the session that got opened; nil In means it never opened
// (check the envelope returned alongside it).
type OpenedCodeSession struct {
	In     *capreg.AssembleInput
	ConvID string
}

// recordVisitorMCPFail —— counts a failure only when the code itself is wrong. A full
// roster or expired code isn't code-guessing; counting those would lock out a
// legitimate visitor for their own unrelated failure.
func (h *Handlers) recordVisitorMCPFail(ctx context.Context, ip string, err error) {
	if errors.Is(err, access.ErrCodeInvalid) {
		h.CodeGuard.RecordFail(ctx, ip)
	}
}

// dispatchIssueSession dispatches to the matching usecase by tier: tier=='code' →
// IssueCodeSession (with an access code); mode=='public'/'byoai'/empty →
// IssuePublicSession, BYOAI fields pass straight through into session data.
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

// clientIP —— visitor's source IP, written into conversations.client_ip for owner IP
// awareness + banning. Produced by the clientaddr middleware: the visitor's real address,
// or empty (unknown). Never parses RemoteAddr itself — with no forwarded header that's the
// app hop, and passing it off as the visitor would lie in the IP column + ban button (F-F-5).
func clientIP(r *http.Request) string {
	return clientaddr.Of(r.Context())
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
	canEmail := owner.CanDeliverCodes(ctx,
		owner.OutboundStatusDeps{Proxy: h.Outbound}, res.Session.Data.OwnerID)
	in := assembleInputFromSession(&res.Session.Data, res.Chat.ID)
	// One walk produces all three (States/ToolSpecs/PromptPartIDs): calling separately
	// cold-dials every external plugin twice — with two networked sandbox plugins that
	// pushed /sessions to ~16s, past the e2e's 15s wait.
	bundle := deps.AgentSkills.AssembleVisitorBundle(ctx, in)
	resp := createSessionResponse{
		SessionToken:   res.Session.Token,
		ConversationID: res.Chat.ID,
		Code:           res.Code,
		MemberID:       res.MemberID,
		CodeLabel:      res.CodeLabel,
		VisitorName:    res.VisitorName,
		MicrositeSlug:  res.MicrositeSlug,
		SystemPromptPersona: conversation.ComposeDynamicPersona(res.Session.Data.RoleSnapshot,
			owner.FullNameOf(ctx, h.Owners, res.Session.Data.OwnerID)),
		Capabilities:        bundle.States,
		ToolSpecs:           bundle.ToolSpecs,
		SystemPromptPartIDs: bundle.PromptPartIDs,
		Ghosts:              nonNilStringSlice(res.Ghosts),
		Quota: sessionQuotaResp{
			MaxTurns:   res.Quota.MaxTurns,
			UsedTurns:  res.Quota.UsedTurns,
			MaxMembers: res.Quota.MaxMembers,
		},
		Members:         toMemberResps(res.Members),
		OwnerCanDeliver: canEmail,
		DockButtons: resolveDockButtons(
			res.Session.Data.RoleSnapshot.DockButtons(), bundle.States,
		),
	}
	// Session token also lands in an HttpOnly cookie (fallback beyond bearer: works
	// across tabs / survives refresh / SSR); Set-Cookie must precede WriteHeader.
	setVisitorSessionCookie(w, res.Session.Token, res.Session.Data.ExpiresAt, h.SecureCookie)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode session resp", "err", err)
	}
}

// nonNilStringSlice —— `ghosts: null` vs `[]` on the wire is a different case for the
// frontend; forcing nil to [] guarantees an array (project principle: empty ≠ nil).
func nonNilStringSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// assembleInputFromSession —— folds a freshly issued VisitorSessionData into
// capreg.AssembleInput; ConversationID comes from res.Chat, not data. Kept consistent
// with dev's /internal/test/visitor-capabilities, so capability shape stays same-source.
func assembleInputFromSession(
	data *access.VisitorSessionData, conversationID string,
) *capreg.AssembleInput {
	return &capreg.AssembleInput{
		RoleSnapshot: data.RoleSnapshot,
		OwnerID:      data.OwnerID,
		Mode:         data.Mode,
		// Subject is the code the visitor holds (public/byoai have none → ungated).
		Subject:        capreg.Subject{Kind: capreg.SubjectCode, ID: data.CodeID},
		Visitor:        data.Visitor,
		ConversationID: conversationID,
	}
}
