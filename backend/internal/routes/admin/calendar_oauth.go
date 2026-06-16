// calendar_oauth.go —— OAuth init + callback + disconnect handlers.
// 从 calendar_connector.go 拆出守 350-line cap.

package admin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"

	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gcal"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// ───── OAuth init ────────────────────────────────────────────

type gcalInitResponse struct {
	AuthURL string `json:"auth_url"`
	State   string `json:"state"`
}

func (h *Handlers) initGCalOAuth() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		conn, err := h.CalendarAdmin.Repo.GetConnector(r.Context(),
			ownerID, domain.CalendarProvider)
		if err != nil {
			h.Log.Error("init gcal: load creds", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		if !conn.HasCredentials() {
			writeError(h.Log, w, envBadReq("paste client_id + client_secret first"))
			return
		}
		runInitGCalOAuth(r, h, w, &conn)
	}
}

func runInitGCalOAuth(
	r *http.Request, h *Handlers, w http.ResponseWriter, conn *domain.CalendarConnector,
) {
	state, serr := randomState(h.CalendarAdmin.Random)
	if serr != nil {
		h.Log.Error("gen state", logErrKey, serr)
		writeError(h.Log, w, serverErr())
		return
	}
	perr := persistOAuthState(r.Context(),
		h.CalendarAdmin.Redis, state, conn.OwnerID)
	if perr != nil {
		h.Log.Error("persist state", logErrKey, perr)
		writeError(h.Log, w, serverErr())
		return
	}
	writeGCalAuthURL(r, h, w, conn, state)
}

// writeGCalAuthURL —— resolve the redirect from owner.PublicURL, build the consent
// URL, write it back. Split out so runInitGCalOAuth stays within the routes ≤3
// cyclo budget.
func writeGCalAuthURL(
	r *http.Request, h *Handlers, w http.ResponseWriter,
	conn *domain.CalendarConnector, state string,
) {
	redirect, rerr := gcalRedirectURI(r.Context(), h, conn.OwnerID)
	if rerr != nil {
		h.Log.Error("gcal redirect uri", logErrKey, rerr)
		writeError(h.Log, w, serverErr())
		return
	}
	authURL := h.CalendarAdmin.GCal.BuildAuthCodeURL(gcal.AuthCodeURLInput{
		ClientID: conn.ClientID, State: state,
		RedirectURI: redirect,
		Scopes:      []string{gcalScope},
	})
	writeJSON(h.Log, w, gcalInitResponse{AuthURL: authURL, State: state})
}

// gcalRedirectURI —— full OAuth redirect_uri = owner.PublicURL + callback path.
// Using the owner's canonical public URL (not r.Host) is what makes this work
// behind a reverse proxy: dev Next / prod Caddy rewrite Host to the internal
// service name (backend:8000), which the browser can't reach and Google rejects
// for non-localhost http. init + callback must pass the identical value.
func gcalRedirectURI(ctx context.Context, h *Handlers, ownerID string) (string, error) {
	owner, err := h.CalendarAdmin.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return "", fmt.Errorf("gcal redirect: load owner: %w", err)
	}
	return owner.PublicURL + gcalCallbackPath, nil
}

func randomState(custom func(n int) (string, error)) (string, error) {
	if custom != nil {
		return customRandom(custom)
	}
	return defaultRandomState()
}

func customRandom(fn func(n int) (string, error)) (string, error) {
	s, err := fn(gcalStateBytes)
	if err != nil {
		return "", fmt.Errorf("custom random: %w", err)
	}
	return s, nil
}

func defaultRandomState() (string, error) {
	buf := make([]byte, gcalStateBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("crypto rand: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func persistOAuthState(
	ctx context.Context, rdb *redis.Client, state, ownerID string,
) error {
	if err := rdb.Set(ctx, gcalStatePrefix+state, ownerID, gcalStateTTL).Err(); err != nil {
		return fmt.Errorf("redis set state: %w", err)
	}
	return nil
}

// ───── OAuth callback ─────────────────────────────────────────

func (h *Handlers) gcalOAuthCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runGCalOAuthCallback(r, h, w)
	}
}

// callbackPrep —— callback 上 OAuth code + connector 打包，避免 3-return。
type callbackPrep struct {
	conn *domain.CalendarConnector
	code string
}

func runGCalOAuthCallback(r *http.Request, h *Handlers, w http.ResponseWriter) {
	prep, ok := callbackPreflight(r, h, w)
	if !ok {
		return
	}
	if eerr := finishOAuthExchange(r, h, w, prep.conn, prep.code); eerr != nil {
		return
	}
	writeJSON(h.Log, w, map[string]bool{"ok": true})
}

func callbackPreflight(
	r *http.Request, h *Handlers, w http.ResponseWriter,
) (*callbackPrep, bool) {
	params, ok := callbackParams(r, h, w)
	if !ok {
		return nil, false
	}
	conn, ok := loadCallbackConnector(r, h, w, params.state)
	if !ok {
		return nil, false
	}
	return &callbackPrep{conn: conn, code: params.code}, true
}

type callbackParamsResult struct {
	code  string
	state string
}

func callbackParams(
	r *http.Request, h *Handlers, w http.ResponseWriter,
) (*callbackParamsResult, bool) {
	q := r.URL.Query()
	code, state := q.Get("code"), q.Get("state")
	if code == "" || state == "" {
		writeError(h.Log, w, envBadReq("missing code or state"))
		return nil, false
	}
	return &callbackParamsResult{code: code, state: state}, true
}

func loadCallbackConnector(
	r *http.Request, h *Handlers, w http.ResponseWriter, state string,
) (*domain.CalendarConnector, bool) {
	ownerID, err := consumeOAuthState(r.Context(), h.CalendarAdmin.Redis, state)
	if err != nil {
		writeError(h.Log, w, envBadReq("invalid or expired state"))
		return nil, false
	}
	conn, lerr := h.CalendarAdmin.Repo.GetConnector(r.Context(),
		ownerID, domain.CalendarProvider)
	if !connectorUsable(&conn, lerr) {
		h.Log.Error("callback: load creds", logErrKey, lerr)
		writeError(h.Log, w, envBadReq("credentials not configured"))
		return nil, false
	}
	return &conn, true
}

func connectorUsable(conn *domain.CalendarConnector, err error) bool {
	return err == nil && conn.HasCredentials()
}

func consumeOAuthState(
	ctx context.Context, rdb *redis.Client, state string,
) (string, error) {
	key := gcalStatePrefix + state
	owner, err := rdb.Get(ctx, key).Result()
	if err != nil {
		return "", fmt.Errorf("redis get state: %w", err)
	}
	if delErr := rdb.Del(ctx, key).Err(); delErr != nil {
		return "", fmt.Errorf("redis del state: %w", delErr)
	}
	return owner, nil
}

func finishOAuthExchange(
	r *http.Request, h *Handlers, w http.ResponseWriter,
	conn *domain.CalendarConnector, code string,
) error {
	token, err := exchangeGCalCode(r.Context(), h, conn, code)
	if err != nil {
		h.Log.Error("exchange code", logErrKey, err)
		writeError(h.Log, w, envBadReq("oauth exchange failed"))
		return err
	}
	if serr := h.CalendarAdmin.Repo.SaveTokens(r.Context(), &postgres.SaveTokensInput{
		OwnerID:      conn.OwnerID,
		Provider:     domain.CalendarProvider,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    token.ExpiresAt,
		Scopes:       []string{gcalScope},
	}); serr != nil {
		h.Log.Error("save tokens", logErrKey, serr)
		writeError(h.Log, w, serverErr())
		return serr
	}
	return nil
}

// exchangeGCalCode —— resolve the (proxy-safe) redirect, then trade the consent
// code for tokens. RedirectURI must match the one BuildAuthCodeURL used.
func exchangeGCalCode(
	ctx context.Context, h *Handlers, conn *domain.CalendarConnector, code string,
) (gcal.TokenResponse, error) {
	redirect, rerr := gcalRedirectURI(ctx, h, conn.OwnerID)
	if rerr != nil {
		return gcal.TokenResponse{}, rerr
	}
	token, err := h.CalendarAdmin.GCal.ExchangeCode(ctx, gcal.ExchangeCodeInput{
		ClientID: conn.ClientID, ClientSecret: conn.ClientSecret,
		Code:        code,
		RedirectURI: redirect,
	})
	if err != nil {
		return gcal.TokenResponse{}, fmt.Errorf("exchange code: %w", err)
	}
	return token, nil
}

// ───── disconnect ─────────────────────────────────────────────

func (h *Handlers) disconnectGCal() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		// 软断开：只擦 tokens，保留 client_id+secret，下次 Authorize 一键。
		if err := h.CalendarAdmin.Repo.ClearTokens(r.Context(),
			ownerID, domain.CalendarProvider); err != nil {
			handleDisconnectErr(h, w, err)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

func handleDisconnectErr(h *Handlers, w http.ResponseWriter, err error) {
	if !errors.Is(err, context.Canceled) {
		h.Log.Error("disconnect gcal", logErrKey, err)
	}
	writeError(h.Log, w, serverErr())
}
