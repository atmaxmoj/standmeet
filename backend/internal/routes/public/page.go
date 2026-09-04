// page.go —— GET /api/v1/instance (single-owner metadata + unclaimed setup token) and
// GET /api/v1/appearance.css (the owner's custom stylesheet). No auth required (public).
//
// The owner's public homepage is now a custom page (the reserved `home` slug served at
// `/`), not built-in page content — so the old GET /api/v1/page is gone.

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// PageHandlers —— dependencies for the page route.
type PageHandlers struct {
	Page owner.PageDeps
	Log  *slog.Logger
	// TokenIssuer is called only while unclaimed; the handler uses it to fetch /
	// self-heal the plaintext.
	TokenIssuer owner.SetupTokenIssuer
	// Outbound —— whether the owner has a usable outbound channel, deciding whether
	// the gate shows the whole "request access" section (don't show it if codes
	// can't be sent out).
	Outbound owner.OutboundStatusDeps
	// CaptchaSiteKey —— /api/v1/instance echoes this to the frontend; the frontend
	// renders the Turnstile widget whenever it's non-empty. The composition root
	// has already decided on/off from env, this just reads the result. An empty
	// string means captcha is off.
	CaptchaSiteKey string
	// AppVersion —— which version this running process is. The /login and admin
	// top-bar badges read it, **rather than each carrying their own constant**:
	// the frontend used to hand-type "v1.0.0" while the backend hand-typed
	// "0.1.0", the two numbers contradicted each other on the same page, and a
	// version number's whole purpose is to say clearly which build you're on
	// when something goes wrong (F-C-10). The composition root passes it in
	// from the sysinfo copy, so /admin/system and the badge read the same
	// value.
	AppVersion string
}

// Mount wires /instance + /appearance.css. Caller owns the prefix (/api/v1).
func (h *PageHandlers) Mount(r chi.Router) {
	r.Get("/instance", h.getInstance())
	r.Get("/appearance.css", h.getAppearanceCSS())
}

// getAppearanceCSS —— GET /api/v1/appearance.css: returns the sole owner's custom CSS
// as a real stylesheet resource (text/css), which the reader page <link>s. Already
// sanitized and scoped to .corpus-content on the backend; no owner / not set → empty
// (no side effects).
func (h *PageHandlers) getAppearanceCSS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		css := ""
		if soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page); err == nil {
			css = h.ownerCustomCSS(r.Context(), soleOwner.ID)
		}
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		if _, werr := w.Write([]byte(css)); werr != nil {
			h.Log.Error("write appearance css", logErrKey, werr)
		}
	}
}

// getInstance —— v1 single-owner instance metadata. Returns {claimed, handle,
// setup_token?}. Fetched by the frontend's root route via SSR:
//   - claimed=true → renders the sole owner's public page (owner.handle used for
//     display)
//   - claimed=false → server-side redirect to /setup?t=<setup_token>, so a first-time
//     visiting operator can enter the claim flow without copying the stdout banner
//
// setup_token is only returned during the unclaimed period; once a claim succeeds, the
// leftover value in the holder is already useless (the claim flow clears
// setup_token_hash, so the old plaintext fails hash comparison on any later claim
// attempt), so even if it leaks it poses no real threat.
func (h *PageHandlers) getInstance() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page)
		if err != nil && !errors.Is(err, owner.ErrOwnerNotFound) {
			h.Log.Error("load sole owner", logErrKey, err)
			writeError(h.Log, w, apierr.Envelope{
				Status:  http.StatusInternalServerError,
				Code:    "server_error",
				Message: "internal error",
			})
			return
		}
		writeInstanceInfo(h.Log, w, &instanceWriteInput{
			owner:          &soleOwner,
			setupToken:     h.unclaimedSetupToken(r.Context(), &soleOwner),
			captchaSiteKey: h.CaptchaSiteKey,
			appVersion:     h.AppVersion,
			canEmailCodes:  owner.CanDeliverCodes(r.Context(), h.Outbound, soleOwner.ID),
		})
	}
}

// unclaimedSetupToken —— returns an empty string once claimed (never exposes the
// token). While unclaimed, fetches a guaranteed-usable plaintext through the usecase
// (self-healing when needed: re-issues if the DB hash is NULL or the holder is
// empty).
func (h *PageHandlers) unclaimedSetupToken(ctx context.Context, o *owner.Owner) string {
	if o.ID != "" || h.TokenIssuer == nil {
		return ""
	}
	return h.ensureUnclaimedTokenOrLog(ctx)
}

func (h *PageHandlers) ensureUnclaimedTokenOrLog(ctx context.Context) string {
	plaintext, err := owner.EnsureUnclaimedSetupToken(ctx, h.TokenIssuer)
	if err != nil {
		h.Log.Error("ensure unclaimed setup token", logErrKey, err)
		return ""
	}
	return plaintext
}

// ownerCustomCSS —— an already-claimed owner's custom CSS (best-effort; unclaimed /
// error → empty).
func (h *PageHandlers) ownerCustomCSS(ctx context.Context, ownerID string) string {
	if ownerID == "" {
		return ""
	}
	css, err := h.Page.Owners.GetCSS(ctx, ownerID)
	if err != nil {
		return ""
	}
	return css
}

// instanceWriteInput —— the packaged input for writeInstanceInfo.
type instanceWriteInput struct {
	owner          *owner.Owner
	setupToken     string
	captchaSiteKey string
	appVersion     string
	canEmailCodes  bool
}

func writeInstanceInfo(log *slog.Logger, w http.ResponseWriter, in *instanceWriteInput) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	view := instanceInfoView{
		Claimed:         in.owner.ID != "",
		Handle:          in.owner.Handle,
		Name:            in.owner.FullName,
		SetupToken:      in.setupToken,
		CaptchaSiteKey:  in.captchaSiteKey,
		Version:         in.appVersion,
		CanDeliverCodes: in.canEmailCodes,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode instance info", logErrKey, err)
	}
}

type instanceInfoView struct {
	Handle         string `json:"handle"`
	Name           string `json:"name"`
	SetupToken     string `json:"setup_token,omitempty"`
	CaptchaSiteKey string `json:"captcha_site_key,omitempty"`
	// Version is the version this process reports; the badge reads it (F-C-10).
	Version         string `json:"version,omitempty"`
	Claimed         bool   `json:"claimed"`
	CanDeliverCodes bool   `json:"can_deliver_codes"`
}
