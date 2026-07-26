// oauth.go —— connectorsvc 的 OAuth dance 内部件：读 client_id、拼 redirect_uri、state 存取、
// code 换 token + 存。endpoints/client 来自 manifest spec + owner 存的凭据，不写死 provider。

package connector

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"
)

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

func (s *Service) persistState(ctx context.Context, state, ownerID, id string) error {
	if err := s.d.Redis.Set(ctx, stateKey(state), ownerID+"|"+id, oauthStateTTL).Err(); err != nil {
		return fmt.Errorf("persist oauth state: %w", err)
	}
	return nil
}

// consumeState —— 校验 + 一次性消费 state（防重放）。返回 (ownerID, err)：空 ownerID = state 无效
// （空/过期/不匹配，预期态）；err 仅在 Redis **故障**时非空——基建错要吵闹，不能跟「state 不存在」
// 混成一个空值掩盖掉。（ownerID 是 UUID，永不为空串，故空串可当「无效」信号，免第三个返回值。）
func (s *Service) consumeState(ctx context.Context, state, id string) (string, error) {
	if state == "" {
		return "", nil
	}
	val, err := s.d.Redis.GetDel(ctx, stateKey(state)).Result()
	switch {
	case errors.Is(err, redis.Nil):
		return "", nil // key 不存在（过期/已用/重放）= 预期态，非故障
	case err != nil:
		return "", fmt.Errorf("read oauth state: %w", err) // Redis 故障 → 上报
	}
	return ownerFromState(val, id), nil
}

// ownerFromState —— state 值 "ownerID|connectorID" 解出 ownerID；连接器不匹配 → ""（无效）。
func ownerFromState(val, id string) string {
	ownerID, connID, found := strings.Cut(val, "|")
	if !found || connID != id {
		return ""
	}
	return ownerID
}

func stateKey(state string) string { return "connector:oauth:" + state }

// danceCtx —— dance 三件套（endpoints + 凭据 + redirect_uri）。
type danceCtx struct {
	cred     oauthCred
	redirect string
	ep       OAuthEndpoints
}

func (s *Service) exchangeAndStore(ctx context.Context, ownerID, id, code string) error {
	dc, err := s.danceContext(ctx, ownerID, id)
	if err != nil {
		return err
	}
	tok, xerr := dc.ep.ExchangeCode(ctx, s.d.HTTP, &ExchangeInput{
		Code: code, ClientID: dc.cred.ClientID,
		ClientSecret: dc.cred.ClientSecret, RedirectURI: dc.redirect,
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
