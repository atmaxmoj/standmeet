// oauth.go —— consent URL builder + token exchange (authorization_code +
// refresh_token grants). See client.go for package docs.

package gcal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// AuthCodeURLInput —— inputs for BuildAuthCodeURL. RedirectURI defaults
// to Client.defaultRedirect when empty.
type AuthCodeURLInput struct {
	ClientID    string
	RedirectURI string
	State       string
	Scopes      []string
}

// BuildAuthCodeURL —— constructs the URL to which the admin browser is
// redirected to start the OAuth dance.
//
// access_type=offline + prompt=consent are critical: without them Google
// returns no refresh_token on the second authorization attempt for the
// same scopes, which silently breaks long-running tokens.
func (c *Client) BuildAuthCodeURL(in AuthCodeURLInput) string {
	redirect := in.RedirectURI
	if redirect == "" {
		redirect = c.defaultRedirect
	}
	q := url.Values{
		"client_id":     {in.ClientID},
		"redirect_uri":  {redirect},
		"response_type": {"code"},
		"scope":         {strings.Join(in.Scopes, " ")},
		"access_type":   {"offline"},
		"prompt":        {"consent"},
		"state":         {in.State},
	}
	sep := "?"
	if strings.Contains(c.authURL, "?") {
		sep = "&"
	}
	return c.authURL + sep + q.Encode()
}

// TokenResponse —— normalized shape Google returns for both the
// authorization_code and refresh_token grants.
//
// RefreshToken is empty when grant_type=refresh_token (Google reuses the
// existing refresh token); callers must keep the prior one.
type TokenResponse struct {
	ExpiresAt    time.Time
	AccessToken  string
	RefreshToken string
	Scope        string
	TokenType    string
}

type tokenWire struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error,omitempty"`
	ExpiresIn    int    `json:"expires_in"`
}

// ExchangeCodeInput —— grant_type=authorization_code params.
type ExchangeCodeInput struct {
	ClientID     string
	ClientSecret string
	Code         string
	RedirectURI  string
}

// ExchangeCode —— first-leg of OAuth. Trades the consent-screen code for
// an access + refresh token pair. RedirectURI must match the one the
// auth URL used (Google enforces).
func (c *Client) ExchangeCode(
	ctx context.Context, in ExchangeCodeInput,
) (TokenResponse, error) {
	return c.tokenRequest(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {in.Code},
		"client_id":     {in.ClientID},
		"client_secret": {in.ClientSecret},
		"redirect_uri":  {in.RedirectURI},
	})
}

// RefreshTokenInput —— grant_type=refresh_token params.
type RefreshTokenInput struct {
	ClientID     string
	ClientSecret string
	RefreshToken string
}

// RefreshToken —— exchanges a long-lived refresh token for a fresh
// short-lived access token. Returns ErrInvalidGrant when the refresh
// token was revoked / expired (caller should mark connector disconnected).
func (c *Client) RefreshToken(
	ctx context.Context, in RefreshTokenInput,
) (TokenResponse, error) {
	return c.tokenRequest(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {in.RefreshToken},
		"client_id":     {in.ClientID},
		"client_secret": {in.ClientSecret},
	})
}

func (c *Client) tokenRequest(
	ctx context.Context, form url.Values,
) (TokenResponse, error) {
	body := strings.NewReader(form.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, body)
	if err != nil {
		return TokenResponse{}, fmt.Errorf("gcal: new token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return TokenResponse{}, transportErr("token request", err)
	}
	out, decErr := decodeToken(resp)
	if cerr := resp.Body.Close(); cerr != nil && decErr == nil {
		return TokenResponse{}, fmt.Errorf("gcal: close token body: %w", cerr)
	}
	return out, decErr
}

func decodeToken(resp *http.Response) (TokenResponse, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes))
	if rerr != nil {
		return TokenResponse{}, fmt.Errorf("gcal: read token body: %w", rerr)
	}
	var w tokenWire
	if uerr := json.Unmarshal(raw, &w); uerr != nil {
		return TokenResponse{},
			fmt.Errorf("gcal: decode token body (status %d): %w", resp.StatusCode, uerr)
	}
	if serr := tokenStatusErr(resp.StatusCode, &w); serr != nil {
		return TokenResponse{}, serr
	}
	return TokenResponse{
		ExpiresAt:    time.Now().Add(time.Duration(w.ExpiresIn) * time.Second),
		AccessToken:  w.AccessToken,
		RefreshToken: w.RefreshToken,
		Scope:        w.Scope,
		TokenType:    w.TokenType,
	}, nil
}

// tokenStatusErr —— token 响应的错误判定：invalid_grant → 不可重 sentinel；非 200
// → 包错（5xx 再裹 ErrServerBusy 让 connector 当瞬时处理，4xx 不重）；200 → nil。
func tokenStatusErr(code int, w *tokenWire) error {
	if w.Error == "invalid_grant" {
		return ErrInvalidGrant
	}
	if code == http.StatusOK {
		return nil
	}
	err := fmt.Errorf("gcal: token request status %d: %s", code, w.Error)
	if transientStatus(code) {
		return fmt.Errorf("%w: %w", err, ErrServerBusy)
	}
	return err
}
