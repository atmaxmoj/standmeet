// oauth.go —— connectorsvc 的 OAuth dance 内部件：读 client_id、拼 redirect_uri、state 存取、
// code 换 token + 存。endpoints/client 来自 manifest spec + owner 存的凭据，不写死 provider。

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

// pkceVerifierBytes —— 32 字节随机 → base64url 43 个字符，正好是 RFC 7636 的下限。
const pkceVerifierBytes = 32

// oauthCred —— oauth2 连接器凭据（owner 的 OAuth app）+ owner 勾选的 scope 子集（带进 dance）。
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

// redirectURI —— full redirect_uri = owner.PublicURL + callback path。
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

// pendingDance —— 一次 dance 在 Redis 里存着的东西：谁、哪个连接器、这次的 PKCE verifier。
// verifier **只能待在服务端**：它就是那个「只有发起方知道」的秘密，跟着 URL 走一遍就没意义了。
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

// newVerifier —— PKCE 的 code_verifier：43–128 个 unreserved 字符（RFC 7636 §4.1）。
// 32 字节随机 → base64url 出 43 个字符，正好是下限。
func newVerifier() (string, error) {
	buf := make([]byte, pkceVerifierBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gen pkce verifier: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// challengeFor —— S256(verifier)，也就是发给 provider 的那一半。
func challengeFor(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// consumeState —— 校验 + 一次性消费 state（防重放）。返回 (ownerID, err)：空 ownerID = state 无效
// （空/过期/不匹配，预期态）；err 仅在 Redis **故障**时非空——基建错要吵闹，不能跟「state 不存在」
// 混成一个空值掩盖掉。（ownerID 是 UUID，永不为空串，故空串可当「无效」信号，免第三个返回值。）
func (s *Service) consumeState(ctx context.Context, state, id string) (pendingDance, error) {
	if state == "" {
		return pendingDance{}, nil
	}
	val, err := s.d.Redis.GetDel(ctx, stateKey(state)).Result()
	switch {
	case errors.Is(err, redis.Nil):
		return pendingDance{}, nil // key 不存在（过期/已用/重放）= 预期态，非故障
	case err != nil:
		return pendingDance{}, fmt.Errorf("read oauth state: %w", err) // Redis 故障 → 上报
	}
	return danceFromState(val, id), nil
}

// danceFromState —— state 值 "ownerID|connectorID|verifier" 解回来；连接器不匹配 →
// 零值（OwnerID 为空 = 无效）。verifier 那一段是后加的，老值（只有两段）解出空 verifier，
// 行为跟从前一致。
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

// initDance —— 起一次 dance：读凭据、拼 redirect_uri、开两个秘密、拼同意页 URL。
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

// openedDance —— 起一次 dance 产出的两个秘密。
type openedDance struct {
	State    string
	Verifier string
}

// openDance —— `state` 防 CSRF，跟着 URL 走一圈回来；PKCE 的 `verifier` 防授权码被截走，
// **只待在服务端**。两个一起存进 Redis，callback 那一步凭 state 把 verifier 取回来。
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

// danceCtx —— dance 三件套（endpoints + 凭据 + redirect_uri）。
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

// danceContext —— 取 dance 三件套（endpoints + 凭据 + redirect_uri）。
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
