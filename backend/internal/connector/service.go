// service.go —— 连接器 admin 编排（存凭据 / connect / oauth callback / activate /
// disconnect）。把这套业务逻辑从 routes 层抽出来（routes handler 强制 cyclo ≤3，只做表现），
// 这里跑在 cyclop ≤5 业务预算上。OAuth dance 复用 OAuthEndpoints（provider 无关）。

package connector

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	oauthStateTTL   = 10 * time.Minute
	oauthStateBytes = 16
)

// sentinel 错误见 errors.go。

// Deps —— 服务依赖（composition root 注入）。Manifests = 内置连接器（id→category/kind/spec）。
type Deps struct {
	Repo      *Repo
	Owners    OwnerLookup
	Redis     *redis.Client
	HTTP      *http.Client
	Verifier  ConnectionVerifier
	Installer Installer
	Manifests []Manifest
}

// Service —— 连接器 admin 编排。
type Service struct{ d *Deps }

// New —— 构造（按指针接装配期依赖束，不按值拷大 struct）。
func New(d *Deps) *Service { return &Service{d: d} }

// Manifest —— 内置 manifest 按 id 查。
func (s *Service) Manifest(id string) *Manifest {
	for i := range s.d.Manifests {
		if s.d.Manifests[i].ID == id {
			return &s.d.Manifests[i]
		}
	}
	return nil
}

// DeclaredOwnerOpIDs —— 各连接器**自己在 manifest 里声明**的 owner 操作 id
// (如 "connectors.mail_test_send")。
//
// admin 路由从这份清单派生自己的路由,所以那一层不写死任何品类名:加一个连接器、
// 它声明一个操作,路由自动就有。清单归连接器轴 —— 谁声明的谁知道。
//
// 只扫内置 manifest,**不是遗漏**:owner-op 唯一的来源是 `connectors/<id>/manifest.yaml`
// 的 `owner_ops:`(见 connectors/loader.go)。owner **上传**的连接器是 spec + 绑定,
// 它暴露的是 agent 工具,没有声明 owner-op 的机制 —— 所以这里没有它要漏的东西。
func (s *Service) DeclaredOwnerOpIDs() []string {
	out := make([]string, 0, len(s.d.Manifests))
	for i := range s.d.Manifests {
		for _, op := range s.d.Manifests[i].OwnerOps {
			out = append(out, op.Name)
		}
	}
	return out
}

// OwnerOpsOf —— 某个内置连接器**自己声明**的 owner 操作。未知 id / 没声明 → 空。
//
// 跟 DeclaredOwnerOpIDs 的分工:那一份是扁平清单,给挂路由用(挂路由不关心谁声明的);
// 这一份按连接器分,给**面**用 —— 一个动作要渲在声明它的那张卡上,否则面就得自己知道
// "mail 卡上有个发信按钮",通用层里又冒出品类名,正是 owner_op.go 要拆掉的那件事。
func (s *Service) OwnerOpsOf(id string) []OwnerOp {
	m := s.Manifest(id)
	if m == nil {
		return []OwnerOp{}
	}
	return m.OwnerOps
}

// Catalog —— 所有内置连接器（拉起时外置装配进来的 manifest），供 admin UI 渲染可连接的内置卡。
// 各卡状态/凭据表单各自再取 /{id}/{status,credential-form}。不进 List（List 只列 owner 已建；内置
// 混进去会被 reuse-by-category 的调用方误抓）。复用 Connection，不新增公开类型。
func (s *Service) Catalog() []Connection {
	out := make([]Connection, 0, len(s.d.Manifests))
	for i := range s.d.Manifests {
		m := &s.d.Manifests[i]
		out = append(out, Connection{
			ConnectorID: m.ID, Category: m.Category, Kind: m.Kind,
		})
	}
	return out
}

// ConnectResult —— Connect 的结果：oauth → AuthURL+State；非 dance → Connected=true。
type ConnectResult struct {
	AuthURL   string
	State     string
	Error     string // 连接测试失败的 owner 友好理由（protocol verify 失败：connect/tls/auth）
	Connected bool
}

// Connect —— oauth2 → 起 dance（建同意页 URL + state 存 Redis）；非 dance → 标 connected。
func (s *Service) Connect(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return ConnectResult{}, merr
	}
	if m.Kind == "protocol" { // protocol（caldav/smtp，无 spec）：connect = 连接测试，无 dance
		return s.verifyAndConnect(ctx, ownerID, id)
	}
	return s.connectOpenAPI(ctx, ownerID, id, m)
}

// Callback —— 校验 state → code 换 token → 存。返回该 owner（state 携带）。
func (s *Service) Callback(ctx context.Context, id, code, state string) error {
	dance, cerr := s.consumeState(ctx, state, id)
	if cerr != nil {
		return fmt.Errorf("oauth callback: %w", cerr) // Redis 故障 → 上报，不掩盖成「坏 state」
	}
	if dance.OwnerID == "" {
		return ErrInvalidOAuthState // state 空/过期/不匹配（预期态）
	}
	if err := s.exchangeAndStore(ctx, &dance, code); err != nil {
		return err
	}
	return s.ensureActive(ctx, dance.OwnerID, id)
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

// Disconnect —— soft disconnect（擦 token + connected + active，留凭据）。断的若是 active 且同品类
// 还有 connected 候选 → 自动 promote 成 active（§1 rule#6 回退，不复闸）；无候选 → 槽空 → 复闸。
func (s *Service) Disconnect(ctx context.Context, ownerID, id string) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return merr
	}
	if err := s.d.Repo.ClearTokens(ctx, ownerID, id); err != nil {
		return fmt.Errorf("disconnect connector: %w", err)
	}
	return s.promoteFallback(ctx, ownerID, m.Category)
}

// List —— owner 已配的连接器。
func (s *Service) List(ctx context.Context, ownerID string,
) ([]Connection, error) {
	conns, err := s.d.Repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list connectors: %w", err)
	}
	return conns, nil
}

// Status —— 单连接器状态。
func (s *Service) Status(
	ctx context.Context, ownerID, id string,
) (Connection, error) {
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
) (*Manifest, error) {
	if m := s.Manifest(id); m != nil {
		return m, nil
	}
	um, err := s.d.Repo.GetManifest(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("load uploaded manifest: %w", err)
	}
	// 空 spec 且非 protocol = 不是 owner 自建连接器（无行 / 内置）。protocol 连接器 spec 本就空。
	if len(um.Spec) == 0 && um.Kind != "protocol" {
		return nil, ErrNotFound
	}
	return &Manifest{
		ID: id, Kind: um.Kind, Category: um.Category, Protocol: um.Protocol,
		AuthScheme: um.AuthScheme, Spec: um.Spec, Binding: um.Binding,
	}, nil
}

// verifyAndConnect —— 非 dance：先跑连接测试（protocol 连接器有；其它 no-op）→ 通过才标 connected。
// connectOpenAPI —— openapi 连接器的 connect：oauth2 → dance；非 oauth（apikey/bearer/basic）→ 存即用；
// 声明了 oauth2 却配坏（缺 authorizationCode flow 等）→ 暴露错，不静默走非-dance（否则 markConnected 却无 token）。
func (s *Service) connectOpenAPI(
	ctx context.Context, ownerID, id string, m *Manifest,
) (ConnectResult, error) {
	ep, err := OAuthEndpointsFor(m, m.AuthScheme)
	switch {
	case errors.Is(err, ErrNotDanceScheme):
		return s.verifyAndConnect(ctx, ownerID, id)
	case err != nil:
		return ConnectResult{}, fmt.Errorf("connect oauth setup: %w", err)
	default:
		return s.initDance(ctx, ownerID, id, ep)
	}
}

func (s *Service) verifyAndConnect(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	if s.d.Verifier != nil {
		if verr := s.d.Verifier.VerifyConnector(ctx, id, ownerID); verr != nil {
			return ConnectResult{Connected: false, Error: verifyReason(verr)}, nil
		}
	}
	return s.markConnected(ctx, ownerID, id)
}

// noCredentialsReason —— 还没存过凭据就点 Connect 时给 owner 的理由。说的是下一步该干什么,
// 不是内部为什么(没有那一行)。
const noCredentialsReason = "fill in this connector's credentials above, then connect"

// verifyReason —— 连接测试失败的 owner 友好理由（分类 connect/tls/auth；非已知 → 通用）。
func verifyReason(err error) string {
	if r := FriendlyVerifyError(err); r != "" {
		return r
	}
	return "the connection test failed — check the host, port, and credentials"
}

// markConnected —— 标 connected。**写不下就说写不下。**
//
// 底下那条 UPDATE 只更新已有的行,而行是"存凭据"那一步建的。owner 一个字都没填就点 Connect
// 时没有行 —— 以前这里照样回 connected:true,卡片翻绿、库里没有,刷新一下"自己就断了"。
// 现在 repo 把 0 行报成 ErrNoConnection,这里翻成 owner 看得懂的下一步(去填表单),
// 跟连接测试失败同一个形状:200 + connected:false + 一句人话。
func (s *Service) markConnected(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	if err := s.d.Repo.MarkConnected(ctx, ownerID, id); err != nil {
		if errors.Is(err, ErrNoConnection) {
			return ConnectResult{Connected: false, Error: noCredentialsReason}, nil
		}
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
	category, err := s.activateCategory(ctx, ownerID, id)
	if err != nil {
		return err
	}
	if category == "" {
		return nil // 定不出品类（无 manifest）→ 静默跳过自动激活
	}
	return s.claimSlotIfFree(ctx, ownerID, id, category)
}

// activateCategory —— 解出该连接器的品类供自动激活。空品类 = 没有 manifest（ErrNotFound），跳过信号；
// 真错（DB 等）→ 上报。
func (s *Service) activateCategory(ctx context.Context, ownerID, id string) (string, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	switch {
	case merr == nil:
		return m.Category, nil
	case errors.Is(merr, ErrNotFound):
		return "", nil
	default:
		return "", fmt.Errorf("manifest for auto-activate: %w", merr)
	}
}

// claimSlotIfFree —— 该品类槽还没有 active 连接器 → 把这个占了（首连即用）；已有则不抢。
func (s *Service) claimSlotIfFree(ctx context.Context, ownerID, id, category string) error {
	conns, err := s.d.Repo.ListByCategory(ctx, ownerID, category)
	if err != nil {
		return fmt.Errorf("list category for auto-activate: %w", err)
	}
	if hasActive(conns) {
		return nil
	}
	if serr := s.d.Repo.SetActive(ctx, ownerID, id, category); serr != nil {
		return fmt.Errorf("auto-activate: %w", serr)
	}
	return nil
}

func hasActive(conns []Connection) bool {
	for i := range conns {
		if conns[i].Active {
			return true
		}
	}
	return false
}

// initDance / openDance 在 svc_oauth.go —— dance 的内部件都在那一边。
