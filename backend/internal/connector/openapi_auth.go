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
)

// 装配期认证相关的 sentinel（回 admin 友好提示）。
var (
	errUnsupportedAuth = errors.New("unsupported connector auth scheme")
	errNoAuthScheme    = errors.New("openapi spec has no security scheme")
	errUnknownScheme   = errors.New("connector references an unknown security scheme")
	errSchemeAmbiguous = errors.New("multiple security schemes; owner must pick one")
	errOAuthExchange   = errors.New("oauth token exchange failed")
	// ErrInvalidGrant —— refresh/exchange 拿到 invalid_grant（owner 在 provider 端撤权 / refresh
	// token 失效）：永久错，不重试，连接落库 disconnected（下个 session 闸掉该能力）。
	ErrInvalidGrant = errors.New("oauth invalid_grant (revoked)")
)

// ConnectionStore —— 连接状态的读 + oauth2 静默刷新的回写（domain 类型）。由 composition root
// 从 ConnectorRepo 接线——connector 层不直依赖 postgres。
type ConnectionStore interface {
	Get(
		ctx context.Context, connectorID, ownerID string,
	) (Connection, error)
	SaveTokens(ctx context.Context, connectorID, ownerID string, tok *TokenRefresh) error
	// MarkDisconnected —— 撤权检测到（invalid_grant）→ 连接落库 disconnected。
	MarkDisconnected(ctx context.Context, connectorID, ownerID string) error
}

// TokenRefresh —— 静默刷新后要回写的 token（connector 层类型，adapter 映射到存储）。
type TokenRefresh struct {
	ExpiresAt    time.Time
	AccessToken  string
	RefreshToken string
	Scopes       []string
}

// authStrategy —— 把一个连接的凭据/token 注入出站请求。单方法、无状态行为，故用 func 类型
// （同 http.HandlerFunc 的取舍）：工厂返 func 值，免去接口 + 一堆空 struct + 接口返值抑制。
type authStrategy func(conn *Connection) (openapi.AuthInjector, error)

// buildAuthStrategy —— 按 securityScheme 选注入策略。不支持的类型 → 错（装配期拒）。
func buildAuthStrategy(scheme *openapi.SecurityScheme) (authStrategy, error) {
	switch scheme.Type {
	case "oauth2", "openIdConnect":
		return oauth2Inject, nil
	case "apiKey":
		return apiKeyInject(scheme.In, scheme.Name), nil
	case "http":
		return httpAuthStrategy(scheme.Scheme)
	default:
		return nil, fmt.Errorf("%w: scheme type %q", errUnsupportedAuth, scheme.Type)
	}
}

func httpAuthStrategy(scheme string) (authStrategy, error) {
	switch scheme {
	case "basic":
		return basicInject, nil
	case "bearer":
		return bearerInject, nil
	default:
		return nil, fmt.Errorf("%w: http scheme %q", errUnsupportedAuth, scheme)
	}
}

// oauth2Inject —— oauth2 / openIdConnect：用存着的 access token 作 bearer。
func oauth2Inject(conn *Connection) (openapi.AuthInjector, error) {
	return bearerInjector(conn.AccessToken), nil
}

type apiKeyCred struct {
	Key string `json:"key"`
}

// apiKeyInject —— apiKey：header 或 query 带 key（in/name 来自 scheme，闭包捕获）。
func apiKeyInject(in, name string) authStrategy {
	return func(conn *Connection) (openapi.AuthInjector, error) {
		var c apiKeyCred
		if err := decodeCred(conn.Credentials, &c); err != nil {
			return nil, err
		}
		key := c.Key
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
}

type basicCred struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// basicInject —— http basic：base64(user:pass) 进 Authorization。
func basicInject(conn *Connection) (openapi.AuthInjector, error) {
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

type bearerCred struct {
	Token string `json:"token"`
}

// bearerInject —— http bearer：凭据里存的固定 token。
func bearerInject(conn *Connection) (openapi.AuthInjector, error) {
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
