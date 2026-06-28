// Package connectorsvc —— 连接器 admin 编排（存凭据 / connect / oauth callback / activate /
// disconnect）。把这套业务逻辑从 routes 层抽出来（routes handler 强制 cyclo ≤3，只做表现），
// 这里跑在 cyclop ≤5 业务预算上。OAuth dance 复用 connector.OAuthEndpoints（provider 无关）。
package connectorsvc

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const (
	oauthStateTTL   = 10 * time.Minute
	oauthStateBytes = 16
)

// ErrNotFound —— 未知连接器 id（内置 manifest 里没有）。
var ErrNotFound = errors.New("connector not found")

// ErrNoOAuthClient —— oauth 连接器还没存 client_id（connect 前必须先存凭据）。
var ErrNoOAuthClient = errors.New("connector oauth client_id not set")

// ErrConnectionFailed —— protocol 连接器的连接测试失败（host/port/auth/TLS 错）。
var ErrConnectionFailed = errors.New("connector connection test failed")

// Verifier —— protocol 连接器 connect 时跑的连接测试（composition root 接 connector.Slots）。
type Verifier interface {
	VerifyConnector(ctx context.Context, connectorID, ownerID string) error
}

// Deps —— 服务依赖（composition root 注入）。Manifests = 内置连接器（id→category/kind/spec）。
type Deps struct {
	Repo      *postgres.ConnectorRepo
	Owners    *postgres.OwnerRepo
	Redis     *redis.Client
	HTTP      *http.Client
	Verifier  Verifier
	Manifests []connector.Manifest
}

// Service —— 连接器 admin 编排。
type Service struct{ d Deps }

// New —— 构造。
func New(d Deps) *Service { return &Service{d: d} }

// Manifest —— 内置 manifest 按 id 查。
func (s *Service) Manifest(id string) *connector.Manifest {
	for i := range s.d.Manifests {
		if s.d.Manifests[i].ID == id {
			return &s.d.Manifests[i]
		}
	}
	return nil
}

// SaveCredentials —— 存凭据（原样 JSON）。category/kind 由内置 manifest 定；未知 id → ErrNotFound。
func (s *Service) SaveCredentials(ctx context.Context, ownerID, id string, body []byte) error {
	m := s.Manifest(id)
	if m == nil {
		return ErrNotFound
	}
	if err := s.d.Repo.SaveCredentials(ctx, &postgres.SaveConnectorCredsInput{
		OwnerID: ownerID, ConnectorID: id,
		Category: m.Category, Kind: m.Kind, Credentials: body,
	}); err != nil {
		return fmt.Errorf("save connector credentials: %w", err)
	}
	return nil
}

// ConnectResult —— Connect 的结果：oauth → AuthURL+State；非 dance → Connected=true。
type ConnectResult struct {
	AuthURL   string
	State     string
	Connected bool
}

// Connect —— oauth2 → 起 dance（建同意页 URL + state 存 Redis）；非 dance → 标 connected。
func (s *Service) Connect(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	m := s.Manifest(id)
	if m == nil {
		return ConnectResult{}, ErrNotFound
	}
	ep, err := connector.OAuthEndpointsFor(m, m.AuthScheme)
	if err != nil {
		return s.verifyAndConnect(ctx, ownerID, id)
	}
	return s.initDance(ctx, ownerID, id, ep)
}

// Callback —— 校验 state → code 换 token → 存。返回该 owner（state 携带）。
func (s *Service) Callback(ctx context.Context, id, code, state string) error {
	ownerID, ok := s.consumeState(ctx, state, id)
	if !ok {
		return fmt.Errorf("%w: invalid oauth state", ErrNoOAuthClient)
	}
	return s.exchangeAndStore(ctx, ownerID, id, code)
}

// Activate —— 占品类槽。Disconnect —— soft disconnect。Status / List —— 读。
func (s *Service) Activate(ctx context.Context, ownerID, id string) error {
	m := s.Manifest(id)
	if m == nil {
		return ErrNotFound
	}
	if err := s.d.Repo.SetActive(ctx, ownerID, id, m.Category); err != nil {
		return fmt.Errorf("activate connector: %w", err)
	}
	return nil
}

// Disconnect —— soft disconnect（擦 token + connected + active，留凭据）。
func (s *Service) Disconnect(ctx context.Context, ownerID, id string) error {
	if err := s.d.Repo.ClearTokens(ctx, ownerID, id); err != nil {
		return fmt.Errorf("disconnect connector: %w", err)
	}
	return nil
}

// List —— owner 已配的连接器。
func (s *Service) List(ctx context.Context, ownerID string) ([]domain.ConnectorConnection, error) {
	conns, err := s.d.Repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list connectors: %w", err)
	}
	return conns, nil
}

// Status —— 单连接器状态。
func (s *Service) Status(
	ctx context.Context, ownerID, id string,
) (domain.ConnectorConnection, error) {
	conn, err := s.d.Repo.Get(ctx, ownerID, id)
	if err != nil {
		return conn, fmt.Errorf("connector status: %w", err)
	}
	conn.ConnectorID = id
	return conn, nil
}

// verifyAndConnect —— 非 dance：先跑连接测试（protocol 连接器有；其它 no-op）→ 通过才标 connected。
func (s *Service) verifyAndConnect(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	if s.d.Verifier != nil {
		if verr := s.d.Verifier.VerifyConnector(ctx, id, ownerID); verr != nil {
			return ConnectResult{}, fmt.Errorf("%w: %w", ErrConnectionFailed, verr)
		}
	}
	return s.markConnected(ctx, ownerID, id)
}

func (s *Service) markConnected(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	if err := s.d.Repo.MarkConnected(ctx, ownerID, id); err != nil {
		return ConnectResult{}, fmt.Errorf("mark connected: %w", err)
	}
	return ConnectResult{Connected: true}, nil
}

func (s *Service) initDance(
	ctx context.Context, ownerID, id string, ep connector.OAuthEndpoints,
) (ConnectResult, error) {
	cred, err := s.loadOAuthCred(ctx, ownerID, id)
	if err != nil {
		return ConnectResult{}, err
	}
	redirect, rerr := s.redirectURI(ctx, ownerID, id)
	if rerr != nil {
		return ConnectResult{}, rerr
	}
	state, serr := randomState()
	if serr != nil {
		return ConnectResult{}, serr
	}
	if perr := s.persistState(ctx, state, ownerID, id); perr != nil {
		return ConnectResult{}, perr
	}
	url := ep.BuildAuthorizeURL(cred.ClientID, redirect, state, nil)
	return ConnectResult{AuthURL: url, State: state}, nil
}
