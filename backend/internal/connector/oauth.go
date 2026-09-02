// oauth.go — the OAuth2 authorization-code dance for openapi connectors (generic, endpoints
// pulled from the spec's securityScheme). Self-hosted: the owner pastes their own
// client_id/secret, there's no global OAuth app. The dance: build the consent-page URL
// (authorizationUrl + client_id + redirect_uri + state + scope) → owner authorizes → callback
// receives a code → exchange for a token (tokenUrl) → store. Endpoints come from the manifest's
// spec; no provider is hardcoded.

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// ErrNotDanceScheme — this connector's securityScheme isn't oauth2 authorization-code
// (apikey/bearer/basic): an **expected non-dance**, connect takes the "save-and-use / connection
// test" path, not an error. Kept separate from "declared oauth2 but misconfigured", which must
// be loud (otherwise a broken oauth connector would silently markConnected with no token).
var ErrNotDanceScheme = errors.New("connector scheme is not an oauth2 authorization-code dance")

// OAuthEndpoints — endpoints parsed out of the spec's oauth2 / openIdConnect scheme.
type OAuthEndpoints struct {
	AuthorizationURL string
	TokenURL         string
	Scopes           []string
}

// OAuthEndpointsFor — parse an openapi manifest's spec and get the authorization-code
// endpoints for the specified scheme. Non-oauth2 / missing authorizationCode flow → error.
func OAuthEndpointsFor(m *Manifest, schemeName string) (OAuthEndpoints, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return OAuthEndpoints{}, fmt.Errorf("connector %q: %w", m.ID, err)
	}
	return oauthEndpointsFromSpec(spec, schemeName)
}

// oauthEndpointsFromSpec — get the authorization-code endpoints from an already-parsed spec
// (schemeName empty = use the sole scheme).
func oauthEndpointsFromSpec(spec *openapi.Spec, schemeName string) (OAuthEndpoints, error) {
	scheme, serr := pickScheme(spec, schemeName)
	if serr != nil {
		return OAuthEndpoints{}, serr
	}
	if scheme.Type != "oauth2" && scheme.Type != "openIdConnect" {
		return OAuthEndpoints{}, ErrNotDanceScheme // apikey/bearer/basic: expected non-dance
	}
	flow := scheme.Flows.AuthorizationCode
	// declared oauth2 but no authorizationCode flow → a real misconfig, report it (don't treat
	// as a silent non-dance)
	if flow == nil {
		return OAuthEndpoints{}, fmt.Errorf("%w: oauth2 scheme has no authorizationCode flow",
			errUnsupportedAuth)
	}
	return OAuthEndpoints{
		AuthorizationURL: flow.AuthorizationURL,
		TokenURL:         flow.TokenURL,
		Scopes:           scopeKeys(flow.Scopes),
	}, nil
}

// RefreshToken — exchange a refresh_token for a new access token (silent refresh; same token
// endpoint as ExchangeCode).
func (e OAuthEndpoints) RefreshToken(
	ctx context.Context, doer openapi.Doer, refreshToken, clientID, clientSecret string,
) (TokenResult, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	return e.postToken(ctx, doer, form)
}

func scopeKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// AuthorizeInput — everything needed to build the consent-page URL. `Challenge` is PKCE's S256
// digest.
type AuthorizeInput struct {
	ClientID    string
	RedirectURI string
	State       string
	Challenge   string
	Scopes      []string
}

// BuildAuthorizeURL — build the consent-page URL. Empty scopes → use everything the spec
// declares.
//
// PKCE (F-C-44): `state` guards against CSRF, `code_challenge` guards against **the
// authorization code being intercepted in transit** — whoever intercepts the code can't
// exchange it for a token without the verifier. This connector's redirect lands on plaintext
// HTTP's loopback, and Google already requires PKCE for installed-app-style clients anyway.
func (e OAuthEndpoints) BuildAuthorizeURL(in *AuthorizeInput) string {
	scopes := in.Scopes
	if len(scopes) == 0 {
		scopes = e.Scopes
	}
	q := url.Values{}
	q.Set("client_id", in.ClientID)
	q.Set("redirect_uri", in.RedirectURI)
	q.Set("response_type", "code")
	q.Set("state", in.State)
	q.Set("access_type", "offline") // get a refresh_token
	q.Set("prompt", "consent")
	if in.Challenge != "" {
		q.Set("code_challenge", in.Challenge)
		q.Set("code_challenge_method", "S256")
	}
	if len(scopes) > 0 {
		q.Set("scope", strings.Join(scopes, " "))
	}
	sep := "?"
	if strings.Contains(e.AuthorizationURL, "?") {
		sep = "&"
	}
	return e.AuthorizationURL + sep + q.Encode()
}

// TokenResult — the token exchanged for a code.
type TokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	Scopes       []string
}

// tokenResponse — the token endpoint's response shape (OAuth2 standard).
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
}

// ExchangeCode — exchange an authorization code for an access/refresh token.
func (e OAuthEndpoints) ExchangeCode(
	ctx context.Context, doer openapi.Doer, in *ExchangeInput,
) (TokenResult, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", in.Code)
	form.Set("client_id", in.ClientID)
	form.Set("client_secret", in.ClientSecret)
	form.Set("redirect_uri", in.RedirectURI)
	if in.CodeVerifier != "" {
		form.Set("code_verifier", in.CodeVerifier)
	}
	return e.postToken(ctx, doer, form)
}

// ExchangeInput — input for exchanging a code for a token. `CodeVerifier` is the plaintext
// behind the challenge sent out during the authorize step (PKCE).
type ExchangeInput struct {
	Code         string
	ClientID     string
	ClientSecret string
	RedirectURI  string
	CodeVerifier string
}

// postToken — POST to the token endpoint (form-urlencoded) + parse the response.
func (e OAuthEndpoints) postToken(
	ctx context.Context, doer openapi.Doer, form url.Values,
) (_ TokenResult, err error) {
	req, rerr := http.NewRequestWithContext(
		ctx, http.MethodPost, e.TokenURL, strings.NewReader(form.Encode()),
	)
	if rerr != nil {
		return TokenResult{}, fmt.Errorf("build token request: %w", rerr)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, derr := doer.Do(req)
	if derr != nil {
		return TokenResult{}, fmt.Errorf("token request: %w", derr)
	}
	defer func() {
		if cerr := resp.Body.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()
	return parseTokenResponse(resp)
}

func parseTokenResponse(resp *http.Response) (TokenResult, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxTokenBytes))
	if rerr != nil {
		return TokenResult{}, fmt.Errorf("read token response: %w", rerr)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return TokenResult{}, classifyTokenError(raw, resp.StatusCode)
	}
	var tr tokenResponse
	if jerr := json.Unmarshal(raw, &tr); jerr != nil {
		return TokenResult{}, fmt.Errorf("decode token response: %w", jerr)
	}
	return buildTokenResult(&tr), nil
}

// classifyTokenError — token endpoint 4xx: invalid_grant (revoked, permanent) → ErrInvalidGrant;
// everything else → errOAuthExchange (includes 5xx, downgraded to transient). An OAuth2 error
// body looks like {"error":"invalid_grant"}.
func classifyTokenError(raw []byte, status int) error {
	var body struct {
		Error string `json:"error"`
	}
	if jerr := json.Unmarshal(raw, &body); jerr == nil && body.Error == "invalid_grant" {
		return ErrInvalidGrant
	}
	// Not invalid_grant: treat 5xx as transient (friendly downgrade + retryable), everything
	// else as permanent. Unified into StatusError so the contract adapter maps it consistently.
	return &openapi.StatusError{Code: status, Transient: status >= http.StatusInternalServerError}
}

// buildTokenResult — token response → TokenResult (parses expires_in / scope).
func buildTokenResult(tr *tokenResponse) TokenResult {
	out := TokenResult{AccessToken: tr.AccessToken, RefreshToken: tr.RefreshToken}
	if tr.ExpiresIn > 0 {
		out.ExpiresAt = nowUTC().Add(time.Duration(tr.ExpiresIn) * time.Second)
	}
	if tr.Scope != "" {
		out.Scopes = strings.Fields(tr.Scope)
	}
	return out
}

const maxTokenBytes = 1 << 20 // 1 MiB

// nowUTC — a clock that can be substituted in tests (defaults to time.Now).
var nowUTC = func() time.Time { return time.Now().UTC() }
