// Package admin 提供 /api/admin/* 路由。当前覆盖 first-run claim、
// login / me / logout / tokens 等。
//
// handler cyclo ≤ 3（routes 层强制）；业务逻辑放 usecase，error 翻译
// 走 internal/apierr/ 的 table-driven Classify。
package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// Handlers 是 admin handlers 需要的依赖。
type Handlers struct {
	AccessRequests    AccessRequestsDeps
	APIKeysAdmin      APIKeysAdminDeps
	Obsidian          ObsidianDeps
	WritingsAdmin     WritingsAdminDeps
	Conversations     ConversationsDeps
	CodesAdmin        CodesDeps
	CapabilitiesAdmin CapabilityAdminDeps
	Claim             owner.ClaimDeps
	RolesAdmin        RolesAdminDeps
	Corpus            CorpusDeps
	Auth              AuthDeps
	KeypairsAdmin     KeypairsAdminDeps
	SkillsAdmin       SkillsAdminDeps
	CustomPagesAdmin  CustomPagesDeps
	MarketplaceAdmin  MarketplaceAdminDeps
	MCPServersAdmin   MCPServersAdminDeps
	BYOAI             BYOAIDeps
	AccountAdmin      AccountDeps
	Recovery          owner.RecoveryDeps
	EmailChange       owner.EmailChangeDeps
	// SeedPlugins —— claim 之后让每个 plugin 种下自己那份 builtin。
	//
	// 由**装配根**注入：插件注册表住在那儿，而这一层够不到它。内核那份种子
	// （SeedPublicRole）在 usecase 里自己跑；插件那份只能从外面递进来 ——
	// 否则插件的东西又会落进内核，只因为种子在那儿。
	//
	// nil = 没有插件要种（老的装配路径 / 测试）。best-effort：失败只记日志，不挡 claim。
	SeedPlugins     func(ctx context.Context, ownerID string) error
	PromptsAdmin    PromptsAdminDeps
	Domains         DomainsDeps
	AIProviderAdmin AIProviderDeps
	ProvidersAdmin  ProvidersAdminDeps
	PublicURLAdmin  PublicURLDeps
	SEOAdmin        SEOAdminDeps
	HandleAdmin     HandleDeps
	Log             *slog.Logger
	PageAdmin       PageAdminDeps
	IPBansAdmin     IPBansAdminDeps
	ConnectorsAdmin ConnectorsAdminDeps
	InstanceAdmin   InstanceAdminDeps // 观测面：system / usage / stats.*
	AppearanceAdmin AppearanceAdminDeps
	// CapabilityConfigAdmin —— 通用的能力配置面(取代每个能力一套手写路由)。
	CapabilityConfigAdmin CapabilityConfigAdminDeps
	SecureCookie          bool
}

// MountUnauthed 挂不需要 owner session 的 endpoint：claim / login。
// loginGuard 是 brute-force 防御（per-IP rate-limit + equal-time response），
// 只裹 /login —— claim 用一次性 setup token，brute-force 不实际。
func (h *Handlers) MountUnauthed(
	r chi.Router, loginGuard func(http.Handler) http.Handler,
) {
	r.Post("/claim", h.claim())
	r.Group(func(r chi.Router) {
		r.Use(loginGuard)
		r.Post("/login", h.login())
		// #100: 公开的账号恢复 —— {email, phrase} 对上就发 session。跟 login 同套 guard 限速
		// (brute-force 面一样)。
		r.Post("/recover", h.recover())
		// 确认改邮箱 —— **公开**：owner 点开这封信时可能在另一台设备上、没登录。
		// 要求先登录才能确认，等于要求他先用还没换过去的那个身份登进来。
		// 不裹 loginGuard：token 是 128-bit 随机 + 只匹配 hash + 一次性 + 24h 过期，
		// 而且这条路造不出新的改动，只能兑现一次 owner 在登录状态下发起过的改动。
		r.Post("/confirm-email", h.confirmEmail())
	})
}

// MountAuthed 挂需要 owner session 的 endpoint。caller 负责先用
// middleware.WithOwner 包这个 router。
//
// credGuard 只裹改凭据那两条（email / password）—— 见 MountAccount。收在这里而不是
// 在 MountAccount 里自己 new，是因为它要 redis，而 redis 住在装配根；跟 MountUnauthed
// 收 loginGuard 是同一个约定。
func (h *Handlers) MountAuthed(r chi.Router, credGuard func(http.Handler) http.Handler) {
	h.MountMe(r)
	r.Post("/me/logout", h.logout())
	r.Get("/csrf", h.csrfEndpoint())
	r.Route("/keypairs", func(r chi.Router) { h.MountKeypairs(r) })
	r.Route("/codes", func(r chi.Router) { h.MountCodes(r) })
	h.MountCorpus(r)
	h.MountCorpusCRUD(r)
	h.MountConversations(r)
	h.MountBYOAI(r)
	h.MountDomains(r)
	h.MountPage(r)
	h.MountSEO(r)
	h.MountAppearance(r)
	h.MountAccessRequests(r)
	h.MountAPIKeys(r)
	h.MountHandle(r)
	h.MountPublicURL(r)
	h.MountAccount(r, credGuard)
	h.MountAIProvider(r)
	h.MountProviders(r)
	h.MountCustomPages(r)
	h.MountSkills(r)
	h.MountPrompts(r)
	h.MountRoles(r)
	h.MountMCPServers(r)
	h.MountWritings(r)
	h.MountObsidian(r)
	h.MountMarketplace(r)
	h.MountConnectors(r)
	h.MountCapabilities(r)
	h.MountCapabilityConfig(r)
	h.MountIPBans(r)
	h.MountInstance(r)
}

type claimRequest struct {
	Token     string `json:"token"`
	Email     string `json:"email"`
	Password  string `json:"password"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
	// 向导第 3 步的 AI provider。可空(那一步明说可跳)，非空就必须落地 ——
	// F-H-2：以前前端收了这三个值就扔了，owner 看到 review 卡印着 provider、
	// claim 也成功，key 却从没写进去。endpoint 不在这里收：它由服务端从
	// ai_provider.presets 那张唯一的表里查，客户端无从自己编一个。
	AIProvider string `json:"ai_provider"`
	AIModel    string `json:"ai_model"`
	AIKey      string `json:"ai_key"`
}

type claimResponse struct {
	OwnerID   string `json:"owner_id"`
	Email     string `json:"email"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
}

// envelope helpers 让 line-length 不超 100。
func envBadReq(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}

// claimErrCases 把 ClaimInstance 可能 propagate 的 sentinel error 翻译成
// HTTP envelope。顺序无关（errors.Is 走的是 unwrap chain）。
var claimErrCases = []apierr.Case{
	{
		Match:    apierr.ErrEmptyField,
		Envelope: envBadReq("missing required field"),
	},
	{
		Match: owner.ErrInvalidSetupToken,
		Envelope: apierr.Envelope{
			Status:  http.StatusUnauthorized,
			Code:    "invalid_setup_token",
			Message: "setup token is invalid or already consumed",
		},
	},
	{
		Match: owner.ErrEmailTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "email_taken", Message: "email already in use",
		},
	},
	{
		Match: owner.ErrHandleTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "handle_taken", Message: "handle already in use",
		},
	},
	{
		Match: owner.ErrPublicURLInvalid,
		Envelope: apierr.Envelope{
			Status:  http.StatusBadRequest,
			Code:    "public_url_invalid",
			Message: "public_url must be a full URL with http(s):// scheme",
		},
	},
}

// claim 是 first-run claim 的 thin handler：解 body、调 usecase、翻译错误 +
// 顺便登录（claim 成功 = owner 凭 setup token 证明了对 instance 的所有权，
// 让 owner 再次输同一份 email/password 是 UX 浪费）。
func (h *Handlers) claim() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req claimRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		h.runClaimAndAutoLogin(w, r, &req)
	}
}

// seedPluginsForOwner —— claim 之后让插件种下自己那份 builtin（jobs 的 hiring
// role/prompt 就是这么来的）。best-effort：失败只记日志，不把 claim 顶回去 ——
// 跟 seedClaimPublicRole 同一个姿势，而且 boot 那一遍还会再补。
func (h *Handlers) seedPluginsForOwner(ctx context.Context, ownerID string) {
	if h.SeedPlugins == nil {
		return
	}
	if err := h.SeedPlugins(ctx, ownerID); err != nil {
		h.Log.Error("seed plugin builtins after claim", "owner_id", ownerID, "err", err)
	}
}

// runClaimAndAutoLogin —— 把 cyclo 控在 ≤3：handler 只做 decode + 派发。
func (h *Handlers) runClaimAndAutoLogin(
	w http.ResponseWriter, r *http.Request, req *claimRequest,
) {
	claimed, err := owner.ClaimInstance(r.Context(), h.Claim, &owner.ClaimInput{
		Token: req.Token, Email: req.Email, Password: req.Password,
		Handle: req.Handle, FullName: req.FullName, PublicURL: req.PublicURL,
	})
	if err != nil {
		handleClaimErr(h.Log, w, err)
		return
	}
	h.seedPluginsForOwner(r.Context(), claimed.ID)
	loggedIn, lerr := owner.Login(r.Context(), h.Auth.Login, &owner.LoginInput{
		Email: req.Email, Password: req.Password,
	})
	if lerr != nil {
		h.Log.Error("auto-login after claim failed", "err", lerr)
		writeError(h.Log, w, serverErr())
		return
	}
	setSessionCookies(w, loggedIn.SessionToken, loggedIn.CSRFToken, h.SecureCookie)
	session.RemoveFirstRunFile(h.Log)
	h.setupAIProvider(r.Context(), claimed.ID, req)
	writeJSONClaim(h.Log, w, &claimed)
}

// setupAIProvider —— 把向导第 3 步的 provider/model/key 落地。
//
// 排在 claim 之后而不是里面:instance 已经归属，token 已经消耗，这一步再失败也
// 不能把 owner 挡在门外。失败**不静默**:这里记 Error 日志，而 owner 那侧
// dashboard 的 NEEDS YOUR HAND 会直说「no usable AI provider — visitors are
// being turned away」。
func (h *Handlers) setupAIProvider(ctx context.Context, ownerID string, req *claimRequest) {
	if req.AIKey == "" {
		return // 第 3 步可跳过(向导自己这么写的)，跳了就什么都不做
	}
	if err := h.applyAIProvider(ctx, ownerID, req); err != nil {
		h.Log.Error("claim: the AI provider from setup did not land",
			"owner_id", ownerID, "provider", req.AIProvider, logErrKey, err)
	}
}

func (h *Handlers) applyAIProvider(
	ctx context.Context, ownerID string, req *claimRequest,
) error {
	endpoint, err := h.presetEndpoint(ctx, ownerID, req.AIProvider)
	if err != nil {
		return err
	}
	args, err := json.Marshal(map[string]string{
		"provider": req.AIProvider, "endpoint": endpoint, "model": req.AIModel,
		"key_change": "set", "key": req.AIKey,
	})
	if err != nil {
		return err
	}
	_, err = h.AIProviderAdmin.Face.MustOp("ai_provider.set").Invoke(ctx, ownerID, args)
	return err
}

// presetEndpoint —— provider 名 → base URL，问的是**同一张 preset 表**
// (`ai_provider.presets`)，不是这一层手抄的第二份。
func (h *Handlers) presetEndpoint(
	ctx context.Context, ownerID, provider string,
) (string, error) {
	raw, err := h.AIProviderAdmin.Face.MustOp("ai_provider.presets").Invoke(ctx, ownerID, nil)
	if err != nil {
		return "", err
	}
	return pickPresetBaseURL(raw, provider)
}

type aiPresetRow struct {
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
}

func pickPresetBaseURL(raw json.RawMessage, provider string) (string, error) {
	var rows []aiPresetRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		return "", fmt.Errorf("decode ai provider presets: %w", err)
	}
	i := slices.IndexFunc(rows, func(p aiPresetRow) bool { return p.Name == provider })
	if i < 0 {
		return "", fmt.Errorf("no preset endpoint for provider %q", provider)
	}
	return rows[i].BaseURL, nil
}

func handleClaimErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, claimErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("claim failed", "err", err)
	}
	writeError(log, w, env)
}

func writeJSONClaim(log *slog.Logger, w http.ResponseWriter, o *owner.Owner) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := claimResponse{
		OwnerID:   o.ID,
		Email:     o.Email,
		Handle:    o.Handle,
		FullName:  o.FullName,
		PublicURL: o.PublicURL,
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode claim response", "err", err)
	}
}

func writeError(log *slog.Logger, w http.ResponseWriter, env apierr.Envelope) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(env.Status)
	payload := map[string]map[string]string{
		"error": {"code": env.Code, "message": env.Message},
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Error("encode error response", "err", err)
	}
}
