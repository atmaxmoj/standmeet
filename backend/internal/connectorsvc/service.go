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

// ErrInvalidManifest —— 上传的 spec/binding 装配期校验失败（坏 JSONata / 未知 op / 缺品类等）。
var ErrInvalidManifest = errors.New("invalid connector spec/binding")

// Verifier —— protocol 连接器 connect 时跑的连接测试（composition root 接 connector.Slots）。
type Verifier interface {
	VerifyConnector(ctx context.Context, connectorID, ownerID string) error
}

// Installer —— 校验（装配）一份上传 manifest + 注册进 live Hub，返回它声明的品类。composition
// root 接 connector.AssembleOpenAPI + Slots.Register。
type Installer interface {
	Install(m *connector.Manifest) (category string, err error)
}

// Deps —— 服务依赖（composition root 注入）。Manifests = 内置连接器（id→category/kind/spec）。
type Deps struct {
	Repo      *postgres.ConnectorRepo
	Owners    *postgres.OwnerRepo
	Redis     *redis.Client
	HTTP      *http.Client
	Verifier  Verifier
	Installer Installer
	Manifests []connector.Manifest
}

// Service —— 连接器 admin 编排。
type Service struct{ d Deps }

// New —— 构造。
//
//nolint:gocritic // Deps 是装配期一次性入参，按值传清晰
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

// CreateUploaded —— 从 owner 贴的 spec + JSONata binding 建一个 openapi 连接器：装配期校验
// （坏 spec/binding/jsonata → ErrInvalidManifest）→ 注册进 live Hub → 存档（拉起重装）。返回 id。
func (s *Service) CreateUploaded(
	ctx context.Context, ownerID string, spec, binding []byte, authScheme string,
) (string, error) {
	id, err := randomState()
	if err != nil {
		return "", err
	}
	m := &connector.Manifest{
		ID: "up-" + id, Kind: "openapi", AuthScheme: authScheme, Spec: spec, Binding: binding,
	}
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf("%w: %w", ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.SaveUploaded(ctx, &postgres.SaveUploadedInput{
		OwnerID: ownerID, ConnectorID: m.ID, Category: cat, Kind: "openapi",
		Spec: spec, Binding: binding, AuthScheme: authScheme,
	}); serr != nil {
		return "", fmt.Errorf("persist uploaded connector: %w", serr)
	}
	return m.ID, nil
}

// SaveCredentials —— 存凭据（原样 JSON）。category/kind 由内置 manifest 定；未知 id → ErrNotFound。
func (s *Service) SaveCredentials(ctx context.Context, ownerID, id string, body []byte) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return merr
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
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return ConnectResult{}, merr
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
	if err := s.exchangeAndStore(ctx, ownerID, id, code); err != nil {
		return err
	}
	return s.ensureActive(ctx, ownerID, id)
}

// Activate —— 占品类槽。Disconnect —— soft disconnect。Status / List —— 读。
func (s *Service) Activate(ctx context.Context, ownerID, id string) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return merr
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

// manifestFor —— 解析一个 id 的 manifest：内置（embed）优先，否则上传连接器（DB 存档的
// spec/binding）。都没有 → ErrNotFound。
func (s *Service) manifestFor(
	ctx context.Context, ownerID, id string,
) (*connector.Manifest, error) {
	if m := s.Manifest(id); m != nil {
		return m, nil
	}
	um, err := s.d.Repo.GetManifest(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("load uploaded manifest: %w", err)
	}
	if len(um.Spec) == 0 { // 空 spec = 不是上传连接器（无行 / 内置）
		return nil, ErrNotFound
	}
	return &connector.Manifest{
		ID: id, Kind: um.Kind, Category: um.Category,
		AuthScheme: um.AuthScheme, Spec: um.Spec, Binding: um.Binding,
	}, nil
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
	if err := s.ensureActive(ctx, ownerID, id); err != nil {
		return ConnectResult{}, err
	}
	return ConnectResult{Connected: true}, nil
}

// ensureActive —— 该品类还没有 active 连接器 → 把刚连上的这个占了槽（首连即用；已有 active
// 则不抢，切换走显式 activate）。§9：同品类同时只一个 active。
func (s *Service) ensureActive(ctx context.Context, ownerID, id string) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return nil //nolint:nilerr // 找不到 manifest → 不自动激活（非致命）
	}
	conns, err := s.d.Repo.ListByCategory(ctx, ownerID, m.Category)
	if err != nil {
		return fmt.Errorf("list category for auto-activate: %w", err)
	}
	if hasActive(conns) {
		return nil
	}
	if serr := s.d.Repo.SetActive(ctx, ownerID, id, m.Category); serr != nil {
		return fmt.Errorf("auto-activate: %w", serr)
	}
	return nil
}

func hasActive(conns []domain.ConnectorConnection) bool {
	for i := range conns {
		if conns[i].Active {
			return true
		}
	}
	return false
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
