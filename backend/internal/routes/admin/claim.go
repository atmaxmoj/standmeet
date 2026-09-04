// Package admin provides the /api/admin/* routes. Currently covers first-run claim,
// login / me / logout / tokens, and more.
//
// Handler cyclo is capped at ≤3 (enforced at the routes layer); business logic lives in
// the usecase, and error translation goes through internal/apierr/'s table-driven Classify.
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

// Handlers holds the dependencies the admin handlers need.
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
	// SeedPlugins — lets each plugin seed its own builtins after claim.
	//
	// Injected by the **assembly root**: that's where the plugin registry lives, and this
	// layer can't reach it. The kernel's own seed (SeedPublicRole) runs itself inside the
	// usecase; the plugins' seed can only be handed in from outside — otherwise plugin
	// stuff would fall back into the kernel, just because the seeding happens there.
	//
	// nil = no plugins to seed (old assembly path / tests). Best-effort: a failure only
	// logs, it never blocks claim.
	SeedPlugins func(ctx context.Context, ownerID string) error
	// InstallHomepage — installs the default homepage as the `home` custom page after claim.
	// Best-effort like SeedPlugins: a failure only logs (the built-in homepage keeps serving),
	// and it's handed in from the composition root so this layer needn't know custom-page deps.
	InstallHomepage func(ctx context.Context, ownerID string) error
	PromptsAdmin    PromptsAdminDeps
	Domains         DomainsDeps
	AIProviderAdmin AIProviderDeps
	ProvidersAdmin  ProvidersAdminDeps
	PublicURLAdmin  PublicURLDeps
	SEOAdmin        SEOAdminDeps
	HandleAdmin     HandleDeps
	Log             *slog.Logger
	IPBansAdmin     IPBansAdminDeps
	ConnectorsAdmin ConnectorsAdminDeps
	InstanceAdmin   InstanceAdminDeps // Observation facade: system / usage / stats.*
	AppearanceAdmin AppearanceAdminDeps
	// CapabilityConfigAdmin — the generic capability-config facade (replaces a
	// hand-written route set per capability).
	CapabilityConfigAdmin CapabilityConfigAdminDeps
	SecureCookie          bool
}

// The mounting of the no-login-required routes lives in mount_unauthed.go — that's a
// question of "which guard layer wraps which route", a separate concern from this claim
// handler itself.

// MountAuthed mounts the endpoints that need an owner session. The caller is responsible
// for wrapping this router with middleware.WithOwner first.
//
// credGuard only wraps the two credential-change routes (email / password) — see
// MountAccount. It's collected here instead of being `new`'d inside MountAccount because
// it needs redis, and redis lives at the assembly root; this is the same convention as
// MountUnauthed collecting loginGuard.
func (h *Handlers) MountAuthed(r chi.Router, credGuard func(http.Handler) http.Handler) {
	h.MountMe(r)
	r.Post("/me/logout", h.logout())
	r.Get("/csrf", h.csrfEndpoint())
	r.Route("/keypairs", func(r chi.Router) { h.MountKeypairs(r) })
	r.Route("/codes", func(r chi.Router) { h.MountCodes(r) })
	r.Route("/embeds", func(r chi.Router) { h.MountEmbeds(r) })
	h.MountCorpus(r)
	h.MountCorpusCRUD(r)
	h.MountConversations(r)
	h.MountBYOAI(r)
	h.MountDomains(r)
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
	// AI provider from wizard step 3. Optional (that step is explicitly skippable), but
	// once non-empty it must land — F-H-2: the frontend used to collect these three
	// values and then drop them; the owner would see the provider printed on the review
	// card and claim would succeed, but the key never actually got written. endpoint
	// isn't collected here: the server looks it up from the single ai_provider.presets
	// table, so the client can never make one up itself.
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

// envelope helpers keep line length under 100.
func envBadReq(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}

// claimErrCases translates the sentinel errors ClaimInstance may propagate into HTTP
// envelopes. Order doesn't matter (errors.Is walks the unwrap chain).
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

// claim is the thin handler for first-run claim: decode the body, call the usecase,
// translate errors, and log in as a side effect (a successful claim already means the
// owner proved instance ownership via the setup token — making them type the same
// email/password again would be wasted UX).
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

// seedPluginsForOwner lets plugins seed their own builtins after claim (that's how the
// jobs plugin's hiring role/prompt get created). Best-effort: a failure only logs, it
// never bounces the claim back — the same posture as seedClaimPublicRole, and the boot
// pass will fill it in again anyway.
func (h *Handlers) seedPluginsForOwner(ctx context.Context, ownerID string) {
	if h.SeedPlugins == nil {
		return
	}
	if err := h.SeedPlugins(ctx, ownerID); err != nil {
		h.Log.Error("seed plugin builtins after claim", "owner_id", ownerID, "err", err)
	}
}

// runClaimAndAutoLogin keeps cyclo at ≤3: the handler only does decode + dispatch.
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
	h.installHomepageForOwner(r.Context(), claimed.ID)
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

// setupAIProvider lands the provider/model/key from wizard step 3.
//
// It runs after claim, not inside it: instance ownership is already established, the
// token is already consumed, and a failure here still must not lock the owner out.
// The failure is **not silent**: it logs an Error here, and the owner-side dashboard's
// NEEDS YOUR HAND will say plainly "no usable AI provider — visitors are being turned
// away".
func (h *Handlers) setupAIProvider(ctx context.Context, ownerID string, req *claimRequest) {
	if req.AIKey == "" {
		return // step 3 is skippable (the wizard says so itself); skip it, do nothing
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

// presetEndpoint — provider name → base URL, queried from **the same preset table**
// (`ai_provider.presets`), not a second copy hand-transcribed at this layer.
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
