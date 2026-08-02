// register.go —— #155 composition root：把统一连接器机器接进运行系统。拉起时把内置
// manifest（builtins）装配进 Hub，用 slot 分派器背书品类 dep；ConnectorRepo 经几个薄适配器
// 满足 connector 层的 ConnectionStore / SMTPVault / SlotStore（凭据解密留在 connector 层内）。

package axisconn

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/connectors"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
)

// connectorEgressAllow —— 出站 SSRF 白名单（CONNECTOR_EGRESS_ALLOW 逗号分隔 hostname；
// e2e 放行 external-mock，prod 留空 = 全拦内网）。
func connectorEgressAllow() connector.EgressAllow {
	return connector.NewEgressAllow(strings.Split(os.Getenv("CONNECTOR_EGRESS_ALLOW"), ","))
}

// connectorEgressClient —— SSRF-guarded 出站客户端（按 allow-list 放行，否则拦内网）。
func connectorEgressClient() *http.Client {
	return connectorEgressAllow().GuardedHTTPClient()
}

// connectionStoreAdapter —— ConnectorRepo → connector.ConnectionStore（换 arg 次序）。
type connectionStoreAdapter struct{ repo *connector.Repo }

func (a connectionStoreAdapter) Get(
	ctx context.Context, connectorID, ownerID string,
) (connector.Connection, error) {
	conn, err := a.repo.Get(ctx, ownerID, connectorID)
	if err != nil {
		return conn, fmt.Errorf("connection store get: %w", err)
	}
	return conn, nil
}

// SaveTokens —— oauth2 静默刷新回写（connector.TokenRefresh → 存储）。
func (a connectionStoreAdapter) SaveTokens(
	ctx context.Context, connectorID, ownerID string, tok *connector.TokenRefresh,
) error {
	if err := a.repo.SaveTokens(ctx, &connector.SaveConnectorTokensInput{
		OwnerID: ownerID, ConnectorID: connectorID,
		AccessToken: tok.AccessToken, RefreshToken: tok.RefreshToken,
		ExpiresAt: tok.ExpiresAt, Scopes: tok.Scopes,
	}); err != nil {
		return fmt.Errorf("connection store save tokens: %w", err)
	}
	return nil
}

// MarkDisconnected —— 撤权检测（invalid_grant）→ 落库 disconnected（清 token + connected + active，
// owner 需重连）。
func (a connectionStoreAdapter) MarkDisconnected(
	ctx context.Context, connectorID, ownerID string,
) error {
	if err := a.repo.ClearTokens(ctx, ownerID, connectorID); err != nil {
		return fmt.Errorf("connection store mark disconnected: %w", err)
	}
	return nil
}

// smtpCredJSON —— smtp 连接器 credentials_enc 里的 JSON 形状。
type smtpCredJSON struct {
	Host        string `json:"host"`
	Port        string `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	FromAddress string `json:"from_address"`
	FromName    string `json:"from_name"`
	TLS         string `json:"tls"`
}

// smtpVaultAdapter —— ConnectorRepo → connector.SMTPVault（解码 smtp 配置 JSON）。
type smtpVaultAdapter struct{ repo *connector.Repo }

func (a smtpVaultAdapter) Connected(
	ctx context.Context, connectorID, ownerID string,
) (bool, error) {
	conn, err := a.repo.Get(ctx, ownerID, connectorID)
	if err != nil {
		return false, fmt.Errorf("smtp vault connected: %w", err)
	}
	return conn.Connected, nil
}

func (a smtpVaultAdapter) SMTPConfig(
	ctx context.Context, connectorID, ownerID string,
) (connector.SMTPConfig, error) {
	conn, err := a.repo.Get(ctx, ownerID, connectorID)
	if err != nil {
		return connector.SMTPConfig{}, fmt.Errorf("smtp vault config: %w", err)
	}
	var c smtpCredJSON
	if len(conn.Credentials) > 0 {
		if uerr := json.Unmarshal(conn.Credentials, &c); uerr != nil {
			return connector.SMTPConfig{}, fmt.Errorf("decode smtp credentials: %w", uerr)
		}
	}
	port, perr := strconv.Atoi(c.Port)
	if perr != nil {
		port = 0 // 解析失败 → 0，连接时失败（友好降级）
	}
	return connector.SMTPConfig{
		Host: c.Host, Port: port, Username: c.Username, Password: c.Password,
		FromAddress: c.FromAddress, FromName: c.FromName, TLS: c.TLS,
	}, nil
}

// caldavCredJSON —— caldav 连接器 credentials_enc 里的 JSON 形状（owner 填的 url/user/pass）。
type caldavCredJSON struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// caldavVaultAdapter —— ConnectorRepo → connector.CalDAVVault（解码 caldav 配置 JSON）。
type caldavVaultAdapter struct{ repo *connector.Repo }

func (a caldavVaultAdapter) Connected(
	ctx context.Context, connectorID, ownerID string,
) (bool, error) {
	conn, err := a.repo.Get(ctx, ownerID, connectorID)
	if err != nil {
		return false, fmt.Errorf("caldav vault connected: %w", err)
	}
	return conn.Connected, nil
}

func (a caldavVaultAdapter) CalDAVConfig(
	ctx context.Context, connectorID, ownerID string,
) (connector.CalDAVConfig, error) {
	conn, err := a.repo.Get(ctx, ownerID, connectorID)
	if err != nil {
		return connector.CalDAVConfig{}, fmt.Errorf("caldav vault config: %w", err)
	}
	var c caldavCredJSON
	if len(conn.Credentials) > 0 {
		if uerr := json.Unmarshal(conn.Credentials, &c); uerr != nil {
			return connector.CalDAVConfig{}, fmt.Errorf("decode caldav credentials: %w", uerr)
		}
	}
	return connector.CalDAVConfig{URL: c.URL, Username: c.Username, Password: c.Password}, nil
}

// slotStoreAdapter —— ConnectorRepo → connector.SlotStore（同品类的 active 连接器 id）。
type slotStoreAdapter struct{ repo *connector.Repo }

func (a slotStoreAdapter) ActiveConnectorID(
	ctx context.Context, ownerID, category string,
) (string, error) {
	conns, err := a.repo.ListByCategory(ctx, ownerID, category)
	if err != nil {
		return "", fmt.Errorf("active connector id: %w", err)
	}
	for i := range conns {
		if conns[i].Active {
			return conns[i].ConnectorID, nil
		}
	}
	return "", nil
}

// EnsureConnectorSlots —— 提前立起 connector Hub + Slots 分派器（只需 ConnectorRepo）。必须在
// buildPluginRegistry 之前调：owner-MCP 插件（calendar / mail / connectors caps）的 deps 在那时
// 就捕获 ConnectorSlots，若那时还 nil 会捕到 nil-backed 分派器 → 运行期调用崩。幂等：discovery
// （RegisterDiscoveredConnectors）复用同一个 hub 往里装内置/上传连接器。
func EnsureConnectorSlots(d *deps.Runtime) {
	if d.ConnectorSlots != nil {
		return
	}
	d.ConnectorHub = connector.NewHub()
	d.ConnectorSlots = connector.NewSlots(d.ConnectorHub, slotStoreAdapter{repo: d.ConnectorRepo})
	d.ConnectorSlots.SetLogger(d.Log) // 后台调用失败要有去处,否则静默
}

// RegisterDiscoveredConnectors —— 拉起时:内置 manifest 装配进 Hub + slot-backed 品类 dep 注册。
// 跟能力轴那边的 RegisterDiscoveredPlugins 同构 —— 宿主不 import 任何具体连接器,契约只有数据。
func RegisterDiscoveredConnectors(
	ctx context.Context, d *deps.Runtime, depReg *capreg.DepRegistry,
) error {
	manifests, err := connectors.Load()
	if err != nil {
		return fmt.Errorf("load builtin connectors: %w", err)
	}
	// slots + hub 早已由 ensureConnectorSlots 立起（owner-MCP 插件 deps 在 buildPluginRegistry
	// 期就捕获 dispatcher，那时 discovery 还没跑）；这里复用同一个 hub 装内置/上传连接器。
	EnsureConnectorSlots(d)
	hub := d.ConnectorHub
	adeps := newAssembleDeps(d.ConnectorRepo)
	for i := range manifests {
		c, aerr := assembleConnector(&manifests[i], adeps)
		if aerr != nil {
			return aerr
		}
		hub.Register(c)
	}
	depReg.Register(capreg.NamedProvider("calendar", d.ConnectorSlots.Calendar().Connected))
	depReg.Register(capreg.NamedProvider("smtp", d.ConnectorSlots.Mail().Connected))
	registerUploadedConnectors(ctx, hub, d.ConnectorRepo, adeps, d.Log)
	return nil
}

// uploadedInstaller —— connectorsvc.Installer：装配（校验）一份自建 manifest + 注册进 live Hub。
type uploadedInstaller struct {
	slots *connector.Slots
	deps  *assembleDeps
}

func (i uploadedInstaller) Install(m *connector.Manifest) (string, error) {
	c, err := assembleConnector(m, i.deps)
	if err != nil {
		return "", fmt.Errorf("assemble connector: %w", err)
	}
	cat, cerr := manifestCategory(m)
	if cerr != nil {
		return "", cerr
	}
	i.slots.Register(c)
	return cat, nil
}

// AgentConnectorSource —— owner 已连、且愿意当 agent 工具的那些连接器,喂给访客装配。
// ListByOwner 过 connected → Hub 解析 → type-assert + expose.
type AgentConnectorSource struct {
	repo  *connector.Repo
	slots *connector.Slots
}

// NewAgentConnectorSource —— 把 owner 已连的连接器里"愿意当 agent 工具"的那些挑出来的口子。
func NewAgentConnectorSource(d *deps.Runtime) *AgentConnectorSource {
	return &AgentConnectorSource{repo: d.ConnectorRepo, slots: d.ConnectorSlots}
}

// AgentConnectors —— owner 已连、且愿意当 agent 工具的那些连接器。
func (s *AgentConnectorSource) AgentConnectors(
	ctx context.Context, ownerID string,
) ([]consumer.AgentToolConnector, error) {
	conns, err := s.repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list connectors for agent tools: %w", err)
	}
	return s.slots.AgentConnectorsByID(connectedIDs(conns)), nil
}

// connectedIDs —— 已 connected 的连接器 id（agent-tools 闸：未连不暴露）。
func connectedIDs(conns []connector.Connection) []string {
	out := make([]string, 0, len(conns))
	for i := range conns {
		if conns[i].Connected {
			out = append(out, conns[i].ConnectorID)
		}
	}
	return out
}

// manifestCategory —— openapi 从 binding 取品类；protocol 用声明的 Category。
func manifestCategory(m *connector.Manifest) (string, error) {
	if m.Kind == "protocol" {
		return m.Category, nil
	}
	if len(m.Binding) == 0 {
		return "", nil // agent-only openapi 连接器（§3）：无品类绑定，不占品类槽
	}
	cat, cerr := connector.BindingCategory(m)
	if cerr != nil {
		return "", fmt.Errorf("binding category: %w", cerr)
	}
	return cat, nil
}

// assembleDeps —— 装配一个连接器要的全部依赖（归一：openapi + 各 protocol 同一套）。
type assembleDeps struct {
	doer        *http.Client
	store       connectionStoreAdapter
	smtpVault   smtpVaultAdapter
	caldavVault caldavVaultAdapter
	allow       connector.EgressAllow
}

func newAssembleDeps(repo *connector.Repo) *assembleDeps {
	allow := connectorEgressAllow()
	return &assembleDeps{
		doer:        allow.GuardedHTTPClient(),
		store:       connectionStoreAdapter{repo: repo},
		smtpVault:   smtpVaultAdapter{repo: repo},
		caldavVault: caldavVaultAdapter{repo: repo},
		allow:       allow,
	}
}

// loadBuiltinConnectorManifests —— admin 路由要的内置 manifest（id→category/kind/spec）。
// 拉起时读一次（embed），失败 → 空（连接器 admin 面空，不挂整个 server）。
func loadBuiltinConnectorManifests(d *deps.Runtime) []connector.Manifest {
	manifests, err := connectors.Load()
	if err != nil {
		d.Log.Error("load builtin connector manifests", "err", err)
		return []connector.Manifest{}
	}
	return manifests
}

// assembleConnector —— 按 kind 把一份 manifest 装配成 Connector（内置/上传、openapi/protocol 同一路）。
func assembleConnector(m *connector.Manifest, d *assembleDeps) (connector.Connector, error) {
	switch m.Kind {
	case "openapi":
		c, err := connector.AssembleOpenAPI(m, d.doer, d.store, d.allow)
		if err != nil {
			return nil, fmt.Errorf("assemble openapi connector: %w", err)
		}
		return c, nil
	case "protocol":
		return assembleProtocolConnector(m, d)
	default:
		return nil, fmt.Errorf("unknown connector kind %q for %q", m.Kind, m.ID)
	}
}

// assembleProtocolConnector —— protocol kind 按 Protocol 选内置协议实现（smtp / caldav …）。
func assembleProtocolConnector(
	m *connector.Manifest, d *assembleDeps,
) (connector.Connector, error) {
	switch m.Protocol {
	case "smtp":
		return connector.NewSMTPConnector(m.ID, d.smtpVault), nil
	case "caldav":
		return connector.NewCalDAVConnector(m.ID, d.caldavVault, d.doer), nil
	default:
		return nil, fmt.Errorf("unknown protocol %q for connector %q", m.Protocol, m.ID)
	}
}
