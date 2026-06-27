// openapi_auth.go —— openapi 连接器的认证：按 spec 的 securityScheme 把「解密后的凭据/token」
// 注入出站请求。凭据形状随 scheme 类型变（apiKey {key} / basic {username,password} / bearer
// {token} / oauth2 用 access token），各 strategy 自己解码 + 注入。
//
// 连接状态由 ConnectionStore 给出（domain 类型，composition root 从 ConnectorRepo 接线——
// connector 层不直依赖 postgres）。oauth2 的过期 refresh 是后续增强（先用存着的 access token）。

package connector

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// 装配期认证相关的 sentinel（回 admin 友好提示）。
var (
	errUnsupportedAuth = errors.New("unsupported connector auth scheme")
	errNoAuthScheme    = errors.New("openapi spec has no security scheme")
	errUnknownScheme   = errors.New("connector references an unknown security scheme")
	errSchemeAmbiguous = errors.New("multiple security schemes; owner must pick one")
	errOAuthExchange   = errors.New("oauth token exchange failed")
)

// ConnectionStore —— 连接状态的读 + oauth2 静默刷新的回写（domain 类型）。由 composition root
// 从 ConnectorRepo 接线——connector 层不直依赖 postgres。
type ConnectionStore interface {
	Get(ctx context.Context, connectorID, ownerID string) (domain.ConnectorConnection, error)
	SaveTokens(ctx context.Context, connectorID, ownerID string, tok *TokenRefresh) error
}

// TokenRefresh —— 静默刷新后要回写的 token（connector 层类型，adapter 映射到存储）。
type TokenRefresh struct {
	ExpiresAt    time.Time
	AccessToken  string
	RefreshToken string
	Scopes       []string
}

// authStrategy —— 把一个连接的凭据/token 注入请求。无状态、按 scheme 类型分。
type authStrategy interface {
	inject(conn *domain.ConnectorConnection) (openapi.AuthInjector, error)
}

// buildAuthStrategy —— 按 securityScheme 选注入策略。不支持的类型 → 错（装配期拒）。
//
//nolint:ireturn // factory：按 scheme 类型返不同 strategy 实现，接口返值是这里的意图。
func buildAuthStrategy(scheme *openapi.SecurityScheme) (authStrategy, error) {
	switch scheme.Type {
	case "oauth2", "openIdConnect":
		return oauth2Strategy{}, nil
	case "apiKey":
		return apiKeyStrategy{in: scheme.In, name: scheme.Name}, nil
	case "http":
		return httpAuthStrategy(scheme.Scheme)
	default:
		return nil, fmt.Errorf("%w: scheme type %q", errUnsupportedAuth, scheme.Type)
	}
}

//nolint:ireturn // 同 buildAuthStrategy：按 http scheme 返不同 strategy。
func httpAuthStrategy(scheme string) (authStrategy, error) {
	switch scheme {
	case "basic":
		return basicStrategy{}, nil
	case "bearer":
		return bearerStrategy{}, nil
	default:
		return nil, fmt.Errorf("%w: http scheme %q", errUnsupportedAuth, scheme)
	}
}

// ─── oauth2 / openIdConnect：用存着的 access token 作 bearer ───

type oauth2Strategy struct{}

func (oauth2Strategy) inject(conn *domain.ConnectorConnection) (openapi.AuthInjector, error) {
	token := conn.AccessToken
	return bearerInjector(token), nil
}

// ─── apiKey：header 或 query 带 key ───

type apiKeyStrategy struct {
	in   string // header | query
	name string
}

type apiKeyCred struct {
	Key string `json:"key"`
}

func (s apiKeyStrategy) inject(conn *domain.ConnectorConnection) (openapi.AuthInjector, error) {
	var c apiKeyCred
	if err := decodeCred(conn.Credentials, &c); err != nil {
		return nil, err
	}
	in, name, key := s.in, s.name, c.Key
	return func(req *http.Request) error {
		if in == "query" {
			q := req.URL.Query()
			q.Set(name, key)
			req.URL.RawQuery = q.Encode()
			return nil
		}
		req.Header.Set(name, key)
		return nil
	}, nil
}

// ─── http basic ───

type basicStrategy struct{}

type basicCred struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (basicStrategy) inject(conn *domain.ConnectorConnection) (openapi.AuthInjector, error) {
	var c basicCred
	if err := decodeCred(conn.Credentials, &c); err != nil {
		return nil, err
	}
	enc := base64.StdEncoding.EncodeToString([]byte(c.Username + ":" + c.Password))
	return func(req *http.Request) error {
		req.Header.Set("Authorization", "Basic "+enc)
		return nil
	}, nil
}

// ─── http bearer：凭据里存的固定 token ───

type bearerStrategy struct{}

type bearerCred struct {
	Token string `json:"token"`
}

func (bearerStrategy) inject(conn *domain.ConnectorConnection) (openapi.AuthInjector, error) {
	var c bearerCred
	if err := decodeCred(conn.Credentials, &c); err != nil {
		return nil, err
	}
	return bearerInjector(c.Token), nil
}

// bearerInjector —— 设 Authorization: Bearer <token>。
func bearerInjector(token string) openapi.AuthInjector {
	return func(req *http.Request) error {
		req.Header.Set("Authorization", "Bearer "+token)
		return nil
	}
}

// decodeCred —— 解码连接的凭据 JSON 进具体凭据类型；空凭据 → 不报错（留给上游 401 友好降级）。
// 用 union-constrained 泛型解码三种凭据形状，避开 connector 包禁用的裸 `any`。
func decodeCred[T apiKeyCred | basicCred | bearerCred](raw []byte, dst *T) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return fmt.Errorf("decode connector credentials: %w", err)
	}
	return nil
}
