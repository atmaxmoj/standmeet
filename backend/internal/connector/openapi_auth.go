// openapi_auth.go — authentication for openapi connectors: injects "decrypted
// credentials/token" into outbound requests per the spec's securityScheme. The credential
// shape varies with the scheme type (apiKey {key} / basic {username,password} / bearer {token}
// / oauth2 uses the access token), each strategy decodes + injects its own.
//
// Connection state is provided by ConnectionStore (a domain type, wired by the composition
// root from ConnectorRepo — the connector layer never depends on postgres directly). oauth2
// expiry refresh is a later enhancement (starts out just using the stored access token).

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

// Sentinels for assembly-time auth (returned as friendly hints to admin).
var (
	errUnsupportedAuth = errors.New("unsupported connector auth scheme")
	errNoAuthScheme    = errors.New("openapi spec has no security scheme")
	errUnknownScheme   = errors.New("connector references an unknown security scheme")
	errSchemeAmbiguous = errors.New("multiple security schemes; owner must pick one")
	errOAuthExchange   = errors.New("oauth token exchange failed")
	// ErrInvalidGrant — a refresh/exchange got back invalid_grant (the owner revoked access at
	// the provider, or the refresh token expired): a permanent error, not retried, the
	// connection is persisted as disconnected (gates that capability for the next session).
	ErrInvalidGrant = errors.New("oauth invalid_grant (revoked)")
)

// ConnectionStore — reads connection state + writes back oauth2 silent-refresh results (a
// domain type). Wired by the composition root from ConnectorRepo — the connector layer never
// depends on postgres directly.
type ConnectionStore interface {
	Get(
		ctx context.Context, connectorID, ownerID string,
	) (Connection, error)
	SaveTokens(ctx context.Context, connectorID, ownerID string, tok *TokenRefresh) error
	// MarkDisconnected — a revocation was detected (invalid_grant) → persist the connection as
	// disconnected.
	MarkDisconnected(ctx context.Context, connectorID, ownerID string) error
}

// TokenRefresh — the token to write back after a silent refresh (a connector-layer type; the
// adapter maps it to storage).
type TokenRefresh struct {
	ExpiresAt    time.Time
	AccessToken  string
	RefreshToken string
	Scopes       []string
}

// authStrategy — injects a connection's credentials/token into an outbound request. Single
// method, stateless behavior, so it's a func type (the same trade-off as http.HandlerFunc): the
// factory returns a func value, sparing an interface plus a pile of empty structs and
// interface-return boilerplate.
type authStrategy func(conn *Connection) (openapi.AuthInjector, error)

// buildAuthStrategy — pick an injection strategy by securityScheme. An unsupported type → error
// (rejected at assembly time).
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

// oauth2Inject — oauth2 / openIdConnect: use the stored access token as bearer.
func oauth2Inject(conn *Connection) (openapi.AuthInjector, error) {
	return bearerInjector(conn.AccessToken), nil
}

type apiKeyCred struct {
	Key string `json:"key"`
}

// apiKeyInject — apiKey: carries the key in a header or query param (in/name come from the
// scheme, captured by closure).
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

// basicInject — http basic: base64(user:pass) goes into Authorization.
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

// bearerInject — http bearer: the fixed token stored in the credentials.
func bearerInject(conn *Connection) (openapi.AuthInjector, error) {
	var c bearerCred
	if err := decodeCred(conn.Credentials, &c); err != nil {
		return nil, err
	}
	return bearerInjector(c.Token), nil
}

// bearerInjector — sets Authorization: Bearer <token>.
func bearerInjector(token string) openapi.AuthInjector {
	return func(req *http.Request) error {
		req.Header.Set("Authorization", "Bearer "+token)
		return nil
	}
}

// decodeCred — decodes a connection's credential JSON into a concrete credential type; empty
// credentials → no error (leaves it for a friendly 401 downgrade upstream). Uses a
// union-constrained generic to decode all three credential shapes, avoiding the bare `any` the
// connector package bans.
func decodeCred[T apiKeyCred | basicCred | bearerCred](raw []byte, dst *T) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return fmt.Errorf("decode connector credentials: %w", err)
	}
	return nil
}
