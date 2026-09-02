// oauth.go — connectorsvc's OAuth dance internals: reading client_id, building redirect_uri,
// state storage/retrieval, exchanging code for a token + storing it. Endpoints/client come from
// the manifest's spec + the owner's stored credentials; no provider is hardcoded.

package connector

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"
)

// pkceVerifierBytes — 32 random bytes → 43 base64url characters, exactly RFC 7636's floor.
const pkceVerifierBytes = 32

// oauthCred — oauth2 connector credentials (the owner's OAuth app) + the scope subset the owner
// checked (carried into the dance).
type oauthCred struct {
	ClientID     string   `json:"client_id"`
	ClientSecret string   `json:"client_secret"`
	Scopes       []string `json:"scopes"`
}

func (s *Service) loadOAuthCred(ctx context.Context, ownerID, id string) (oauthCred, error) {
	conn, err := s.d.Repo.Get(ctx, ownerID, id)
	if err != nil {
		return oauthCred{}, fmt.Errorf("load connector: %w", err)
	}
	var cred oauthCred
	if len(conn.Credentials) > 0 {
		if uerr := json.Unmarshal(conn.Credentials, &cred); uerr != nil {
			return oauthCred{}, fmt.Errorf("decode oauth credentials: %w", uerr)
		}
	}
	if cred.ClientID == "" {
		return oauthCred{}, ErrNoOAuthClient
	}
	return cred, nil
}

// redirectURI — full redirect_uri = owner.PublicURL + callback path.
func (s *Service) redirectURI(ctx context.Context, ownerID, id string) (string, error) {
	base, err := s.d.Owners.PublicURL(ctx, ownerID)
	if err != nil {
		return "", fmt.Errorf("load owner public url: %w", err)
	}
	return base + "/api/admin/connectors/" + id + "/callback", nil
}

func randomState() (string, error) {
	buf := make([]byte, oauthStateBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gen oauth state: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// pendingDance — what one dance has stored in Redis: who, which connector, this round's PKCE
// verifier. The verifier **must stay server-side only**: it's the secret that "only the
// initiator knows", and sending it along the URL would defeat its whole purpose.
type pendingDance struct {
	OwnerID     string
	ConnectorID string
	Verifier    string
}

func (s *Service) persistState(ctx context.Context, state string, d *pendingDance) error {
	val := d.OwnerID + "|" + d.ConnectorID + "|" + d.Verifier
	if err := s.d.Redis.Set(ctx, stateKey(state), val, oauthStateTTL).Err(); err != nil {
		return fmt.Errorf("persist oauth state: %w", err)
	}
	return nil
}

// newVerifier — PKCE's code_verifier: 43–128 unreserved characters (RFC 7636 §4.1).
// 32 random bytes → base64url yields 43 characters, exactly the floor.
func newVerifier() (string, error) {
	buf := make([]byte, pkceVerifierBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gen pkce verifier: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// challengeFor — S256(verifier), the half sent to the provider.
func challengeFor(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// consumeState — validates + consumes state exactly once (anti-replay). Returns
// (ownerID, err): empty ownerID = invalid state (empty/expired/mismatched, an expected state);
// err is non-nil only on a Redis **fault** — infrastructure errors must be loud, never masked
// into an empty value alongside "state doesn't exist". (ownerID is a UUID and is never an empty
// string, so an empty string can serve as the "invalid" signal without needing a third return
// value.)
func (s *Service) consumeState(ctx context.Context, state, id string) (pendingDance, error) {
	if state == "" {
		return pendingDance{}, nil
	}
	val, err := s.d.Redis.GetDel(ctx, stateKey(state)).Result()
	switch {
	case errors.Is(err, redis.Nil):
		// key doesn't exist (expired/used/replayed) = expected state, not a fault
		return pendingDance{}, nil
	case err != nil:
		return pendingDance{}, fmt.Errorf("read oauth state: %w", err) // Redis fault → reported
	}
	return danceFromState(val, id), nil
}

// danceFromState — decodes the state value "ownerID|connectorID|verifier" back; connector
// mismatch → zero value (empty OwnerID = invalid). The verifier segment was added later; an old
// value (only two segments) decodes to an empty verifier, keeping prior behavior unchanged.
func danceFromState(val, id string) pendingDance {
	ownerID, rest, found := strings.Cut(val, "|")
	if !found {
		return pendingDance{}
	}
	connID, verifier, _ := strings.Cut(rest, "|")
	if connID != id {
		return pendingDance{}
	}
	return pendingDance{OwnerID: ownerID, ConnectorID: connID, Verifier: verifier}
}

func stateKey(state string) string { return "connector:oauth:" + state }

// initDance — starts one dance: reads credentials, builds redirect_uri, generates the two
// secrets, builds the consent-page URL.
func (s *Service) initDance(
	ctx context.Context, ownerID, id string, ep OAuthEndpoints,
) (ConnectResult, error) {
	cred, err := s.loadOAuthCred(ctx, ownerID, id)
	if err != nil {
		return ConnectResult{}, err
	}
	redirect, rerr := s.redirectURI(ctx, ownerID, id)
	if rerr != nil {
		return ConnectResult{}, rerr
	}
	open, perr := s.openDance(ctx, ownerID, id)
	if perr != nil {
		return ConnectResult{}, perr
	}
	url := ep.BuildAuthorizeURL(&AuthorizeInput{
		ClientID: cred.ClientID, RedirectURI: redirect, State: open.State,
		Challenge: challengeFor(open.Verifier), Scopes: cred.Scopes,
	})
	return ConnectResult{AuthURL: url, State: open.State}, nil
}

// openedDance — the two secrets produced by starting one dance.
type openedDance struct {
	State    string
	Verifier string
}

// openDance — `state` guards against CSRF and travels the URL round trip; PKCE's `verifier`
// guards against the authorization code being intercepted, and **stays server-side only**. Both
// are stored together in Redis, and the callback step retrieves the verifier by state.
func (s *Service) openDance(ctx context.Context, ownerID, id string) (openedDance, error) {
	state, serr := randomState()
	if serr != nil {
		return openedDance{}, serr
	}
	verifier, verr := newVerifier()
	if verr != nil {
		return openedDance{}, verr
	}
	if perr := s.persistState(ctx, state, &pendingDance{
		OwnerID: ownerID, ConnectorID: id, Verifier: verifier,
	}); perr != nil {
		return openedDance{}, perr
	}
	return openedDance{State: state, Verifier: verifier}, nil
}

// danceCtx — the dance's three-piece bundle (endpoints + credentials + redirect_uri).
type danceCtx struct {
	cred     oauthCred
	redirect string
	ep       OAuthEndpoints
}

func (s *Service) exchangeAndStore(ctx context.Context, d *pendingDance, code string) error {
	ownerID, id := d.OwnerID, d.ConnectorID
	dc, err := s.danceContext(ctx, ownerID, id)
	if err != nil {
		return err
	}
	tok, xerr := dc.ep.ExchangeCode(ctx, s.d.HTTP, &ExchangeInput{
		Code: code, ClientID: dc.cred.ClientID,
		ClientSecret: dc.cred.ClientSecret, RedirectURI: dc.redirect,
		CodeVerifier: d.Verifier,
	})
	if xerr != nil {
		return fmt.Errorf("exchange oauth code: %w", xerr)
	}
	if serr := s.d.Repo.SaveTokens(ctx, &SaveConnectorTokensInput{
		OwnerID: ownerID, ConnectorID: id,
		AccessToken: tok.AccessToken, RefreshToken: tok.RefreshToken,
		ExpiresAt: tok.ExpiresAt, Scopes: tok.Scopes,
	}); serr != nil {
		return fmt.Errorf("save connector tokens: %w", serr)
	}
	return nil
}

// danceContext — fetches the dance's three-piece bundle (endpoints + credentials +
// redirect_uri).
func (s *Service) danceContext(ctx context.Context, ownerID, id string) (danceCtx, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return danceCtx{}, merr
	}
	ep, eerr := OAuthEndpointsFor(m, m.AuthScheme)
	if eerr != nil {
		return danceCtx{}, fmt.Errorf("oauth endpoints: %w", eerr)
	}
	cred, cerr := s.loadOAuthCred(ctx, ownerID, id)
	if cerr != nil {
		return danceCtx{}, cerr
	}
	redirect, rerr := s.redirectURI(ctx, ownerID, id)
	if rerr != nil {
		return danceCtx{}, rerr
	}
	return danceCtx{ep: ep, cred: cred, redirect: redirect}, nil
}
