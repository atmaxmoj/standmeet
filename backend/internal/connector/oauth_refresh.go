// oauth_refresh.go —— oauth2 连接器的静默 token 刷新。注入出站请求前，若 access token 过期且有
// refresh_token，就拿 refresh_token 去 token 端点换新 access token、回写存储、用新 token 注入。
// 端点来自 spec，client_id/secret 来自 owner 存的凭据——provider 无关。

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// oauthRefresher —— 给一个 oauth2 连接器做静默刷新。装配期建（端点定，doer/store 注入）。
type oauthRefresher struct {
	doer      openapi.Doer
	store     ConnectionStore
	endpoints OAuthEndpoints
}

// maybeRefresh —— token 没过期 / 无 refresh_token → 不动；否则走 doRefresh。
func (r *oauthRefresher) maybeRefresh(
	ctx context.Context, connectorID, ownerID string, conn *Connection,
) error {
	if !tokenExpired(conn) || conn.RefreshToken == "" {
		return nil
	}
	return r.doRefresh(ctx, connectorID, ownerID, conn)
}

// doRefresh —— 拿 refresh_token 换新 token + 回写 + 就地更新 conn。
func (r *oauthRefresher) doRefresh(
	ctx context.Context, connectorID, ownerID string, conn *Connection,
) error {
	cred, err := decodeClientCred(conn.Credentials)
	if err != nil {
		return err
	}
	tok, rerr := r.endpoints.RefreshToken(
		ctx, r.doer, conn.RefreshToken, cred.ClientID, cred.ClientSecret)
	if rerr != nil {
		return r.handleRefreshErr(ctx, connectorID, ownerID, rerr)
	}
	refresh := pickRefreshToken(conn.RefreshToken, tok.RefreshToken)
	if serr := r.store.SaveTokens(ctx, connectorID, ownerID, &TokenRefresh{
		AccessToken: tok.AccessToken, RefreshToken: refresh,
		ExpiresAt: tok.ExpiresAt, Scopes: tok.Scopes,
	}); serr != nil {
		return fmt.Errorf("persist refreshed token: %w", serr)
	}
	conn.AccessToken = tok.AccessToken
	conn.RefreshToken = refresh
	conn.TokenExpiresAt = &tok.ExpiresAt
	return nil
}

// handleRefreshErr —— invalid_grant（撤权）→ 落库 disconnected（下个 session 闸掉）+ 透传错；
// 其余瞬时错只透传（上层映射成「稍后再试」降级，不动连接状态）。
func (r *oauthRefresher) handleRefreshErr(
	ctx context.Context, connectorID, ownerID string, rerr error,
) error {
	if errors.Is(rerr, ErrInvalidGrant) {
		if derr := r.store.MarkDisconnected(ctx, connectorID, ownerID); derr != nil {
			return fmt.Errorf("mark disconnected after invalid_grant: %w", derr)
		}
	}
	return fmt.Errorf("refresh token: %w", rerr)
}

// pickRefreshToken —— provider 可能不回新 refresh_token → 留旧的。
func pickRefreshToken(old, fresh string) string {
	if fresh != "" {
		return fresh
	}
	return old
}

// tokenExpired —— 有过期时间且已过（无过期时间 = 不过期，不刷）。
func tokenExpired(conn *Connection) bool {
	return conn.TokenExpiresAt != nil && nowUTC().After(*conn.TokenExpiresAt)
}

// clientCred —— oauth2 连接器存的 {client_id, client_secret}。
type clientCred struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

func decodeClientCred(raw []byte) (clientCred, error) {
	var c clientCred
	if len(raw) == 0 {
		return clientCred{}, fmt.Errorf("%w: no client credentials stored", errOAuthExchange)
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return clientCred{}, fmt.Errorf("decode client credentials: %w", err)
	}
	return c, nil
}

// buildRefresher —— oauth2/openIdConnect scheme → 建刷新器；其它 → nil（无需刷新）。
func buildRefresher(
	spec *openapi.Spec, schemeName string, doer openapi.Doer, store ConnectionStore,
) *oauthRefresher {
	scheme, err := pickScheme(spec, schemeName)
	if err != nil {
		return nil
	}
	if scheme.Type != "oauth2" && scheme.Type != "openIdConnect" {
		return nil
	}
	ep, eerr := oauthEndpointsFromSpec(spec, schemeName)
	if eerr != nil {
		return nil
	}
	return &oauthRefresher{doer: doer, store: store, endpoints: ep}
}
