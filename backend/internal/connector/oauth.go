// oauth.go —— openapi 连接器的 OAuth2 authorization-code dance（通用，从 spec 的 securityScheme
// 取端点）。自托管：owner 贴自己的 client_id/secret，没有全局 OAuth app。dance：build 同意页
// URL（authorizationUrl + client_id + redirect_uri + state + scope）→ owner 授权 → callback 拿
// code → 换 token（tokenUrl）→ 存。endpoints 来自 manifest 的 spec，不写死任何 provider。

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

// ErrNotDanceScheme —— 该连接器的 securityScheme 不是 oauth2 authorization-code（apikey/bearer/basic）：
// **预期的非-dance**，connect 走「存即用 / 连接测试」路，不是错。跟「声明了 oauth2 却配坏」分开，
// 后者要吵闹（否则坏 oauth 连接器会静默 markConnected 却没 token）。
var ErrNotDanceScheme = errors.New("connector scheme is not an oauth2 authorization-code dance")

// OAuthEndpoints —— spec 的 oauth2 / openIdConnect scheme 解析出的端点。
type OAuthEndpoints struct {
	AuthorizationURL string
	TokenURL         string
	Scopes           []string
}

// OAuthEndpointsFor —— 解析 openapi manifest 的 spec，取指定 scheme 的 authorization-code 端点。
// 非 oauth2 / 缺 authorizationCode flow → 错。
func OAuthEndpointsFor(m *Manifest, schemeName string) (OAuthEndpoints, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return OAuthEndpoints{}, fmt.Errorf("connector %q: %w", m.ID, err)
	}
	return oauthEndpointsFromSpec(spec, schemeName)
}

// oauthEndpointsFromSpec —— 从已解析 spec 取 authorization-code 端点（schemeName 空 = 唯一那个）。
func oauthEndpointsFromSpec(spec *openapi.Spec, schemeName string) (OAuthEndpoints, error) {
	scheme, serr := pickScheme(spec, schemeName)
	if serr != nil {
		return OAuthEndpoints{}, serr
	}
	if scheme.Type != "oauth2" && scheme.Type != "openIdConnect" {
		return OAuthEndpoints{}, ErrNotDanceScheme // apikey/bearer/basic：预期非 dance
	}
	flow := scheme.Flows.AuthorizationCode
	if flow == nil { // 声明了 oauth2 却没 authorizationCode flow → 真配错，上报（不静默非-dance）
		return OAuthEndpoints{}, fmt.Errorf("%w: oauth2 scheme has no authorizationCode flow",
			errUnsupportedAuth)
	}
	return OAuthEndpoints{
		AuthorizationURL: flow.AuthorizationURL,
		TokenURL:         flow.TokenURL,
		Scopes:           scopeKeys(flow.Scopes),
	}, nil
}

// RefreshToken —— 用 refresh_token 换新 access token（静默刷新；token 端点同 ExchangeCode）。
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

// BuildAuthorizeURL —— 拼同意页 URL。scopes 空 → 用 spec 声明的全部。
func (e OAuthEndpoints) BuildAuthorizeURL(
	clientID, redirectURI, state string, scopes []string,
) string {
	if len(scopes) == 0 {
		scopes = e.Scopes
	}
	q := url.Values{}
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("state", state)
	q.Set("access_type", "offline") // 拿 refresh_token
	q.Set("prompt", "consent")
	if len(scopes) > 0 {
		q.Set("scope", strings.Join(scopes, " "))
	}
	sep := "?"
	if strings.Contains(e.AuthorizationURL, "?") {
		sep = "&"
	}
	return e.AuthorizationURL + sep + q.Encode()
}

// TokenResult —— code 换出的 token。
type TokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	Scopes       []string
}

// tokenResponse —— token 端点的响应形状（OAuth2 标准）。
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
}

// ExchangeCode —— 拿 authorization code 换 access/refresh token。
func (e OAuthEndpoints) ExchangeCode(
	ctx context.Context, doer openapi.Doer, in *ExchangeInput,
) (TokenResult, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", in.Code)
	form.Set("client_id", in.ClientID)
	form.Set("client_secret", in.ClientSecret)
	form.Set("redirect_uri", in.RedirectURI)
	return e.postToken(ctx, doer, form)
}

// ExchangeInput —— code 换 token 的入参。
type ExchangeInput struct {
	Code         string
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

// postToken —— POST token 端点（form-urlencoded）+ 解析。
func (e OAuthEndpoints) postToken(
	ctx context.Context, doer openapi.Doer, form url.Values,
) (_ TokenResult, err error) {
	req, rerr := http.NewRequestWithContext(
		ctx, http.MethodPost, e.TokenURL, strings.NewReader(form.Encode()))
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

// classifyTokenError —— token 端点 4xx：invalid_grant（撤权，永久）→ ErrInvalidGrant；其余 →
// errOAuthExchange（含 5xx，瞬时降级）。OAuth2 错误体形如 {"error":"invalid_grant"}。
func classifyTokenError(raw []byte, status int) error {
	var body struct {
		Error string `json:"error"`
	}
	if jerr := json.Unmarshal(raw, &body); jerr == nil && body.Error == "invalid_grant" {
		return ErrInvalidGrant
	}
	// 非 invalid_grant：5xx 当瞬时（友好降级 + 可重试），其余永久。归一到 StatusError 让
	// 契约适配器统一映射。
	return &openapi.StatusError{Code: status, Transient: status >= http.StatusInternalServerError}
}

// buildTokenResult —— token 响应 → TokenResult（解析 expires_in / scope）。
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

// nowUTC —— 可在测试里替换的时钟（默认 time.Now）。
var nowUTC = func() time.Time { return time.Now().UTC() }
