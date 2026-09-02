// oauth_refresh.go — silent token refresh for oauth2 connectors. Before injecting an outbound
// request, if the access token has expired and a refresh_token is present, exchange the
// refresh_token at the token endpoint for a new access token, persist it, and inject with the
// new token. Endpoints come from the spec, client_id/secret come from the owner's stored
// credentials — provider-agnostic.

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// oauthRefresher — does silent refresh for one oauth2 connector. Built at assembly time
// (endpoints fixed, doer/store injected).
type oauthRefresher struct {
	doer      openapi.Doer
	store     ConnectionStore
	endpoints OAuthEndpoints
}

// maybeRefresh — token not expired / no refresh_token → leave it alone; otherwise runs
// doRefresh.
func (r *oauthRefresher) maybeRefresh(
	ctx context.Context, connectorID, ownerID string, conn *Connection,
) error {
	if !tokenExpired(conn) || conn.RefreshToken == "" {
		return nil
	}
	return r.doRefresh(ctx, connectorID, ownerID, conn)
}

// doRefresh — exchange refresh_token for a new token + persist + update conn in place.
func (r *oauthRefresher) doRefresh(
	ctx context.Context, connectorID, ownerID string, conn *Connection,
) error {
	cred, err := decodeClientCred(conn.Credentials)
	if err != nil {
		return err
	}
	tok, rerr := r.endpoints.RefreshToken(
		ctx, r.doer, conn.RefreshToken, cred.ClientID, cred.ClientSecret,
	)
	if rerr != nil {
		return r.handleRefreshErr(ctx, connectorID, ownerID, rerr)
	}
	refresh := pickRefreshToken(conn.RefreshToken, tok.RefreshToken)
	if serr := r.store.SaveTokens(ctx, connectorID, ownerID, &TokenRefresh{
		AccessToken: tok.AccessToken, RefreshToken: refresh,
		ExpiresAt: tok.ExpiresAt, Scopes: pickScopes(conn.Scopes, tok.Scopes),
	}); serr != nil {
		return fmt.Errorf("persist refreshed token: %w", serr)
	}
	conn.AccessToken = tok.AccessToken
	conn.RefreshToken = refresh
	conn.TokenExpiresAt = &tok.ExpiresAt
	return nil
}

// handleRefreshErr — invalid_grant (revoked) → persist disconnected (gates the next session) +
// pass the error through; other transient errors are just passed through (the caller maps them
// to a "try again later" downgrade, connection state untouched).
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

// pickRefreshToken — the provider may not return a new refresh_token → keep the old one.
func pickRefreshToken(old, fresh string) string {
	if fresh != "" {
		return fresh
	}
	return old
}

// pickScopes — the same reasoning applied to the field next door (F-C-43). RFC 6749 §5.1: a
// token response **may omit `scope`** when it's unchanged. Omitted ≠ nothing was granted — and
// if this field were persisted as-is, one silent refresh would wipe the granted scope down to
// empty.
//
// It's a payload now, not just a record: after F-B-8, assembly-time code cross-checks it
// against the scope each action requires. Wiping it out means that an hour after the owner
// connects, visitor-side booking **silently disappears**, while the card still says connected.
// Only update it when the provider explicitly says so; keep it as-is when the provider says
// nothing.
func pickScopes(old, fresh []string) []string {
	if len(fresh) > 0 {
		return fresh
	}
	return old
}

// tokenExpired — has an expiry time and it has passed (no expiry time = never expires, no
// refresh).
func tokenExpired(conn *Connection) bool {
	return conn.TokenExpiresAt != nil && nowUTC().After(*conn.TokenExpiresAt)
}

// clientCred — the {client_id, client_secret} an oauth2 connector stores.
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

// buildRefresher — oauth2/openIdConnect scheme → build a refresher; anything else → nil (no
// refresh needed).
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
