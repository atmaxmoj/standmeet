// connectors_wire.go —— #155 composition root：把统一连接器机器接进运行系统。拉起时把内置
// manifest（builtins）装配进 Hub，用 slot 分派器背书品类 dep；ConnectorRepo 经几个薄适配器
// 满足 connector 层的 ConnectionStore / SMTPVault / SlotStore（凭据解密留在 connector 层内）。

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/builtins"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// connectionStoreAdapter —— ConnectorRepo → connector.ConnectionStore（换 arg 次序）。
type connectionStoreAdapter struct{ repo *postgres.ConnectorRepo }

func (a connectionStoreAdapter) Get(
	ctx context.Context, connectorID, ownerID string,
) (domain.ConnectorConnection, error) {
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
	if err := a.repo.SaveTokens(ctx, &postgres.SaveConnectorTokensInput{
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
}

// smtpVaultAdapter —— ConnectorRepo → connector.SMTPVault（解码 smtp 配置 JSON）。
type smtpVaultAdapter struct{ repo *postgres.ConnectorRepo }

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
		FromAddress: c.FromAddress, FromName: c.FromName,
	}, nil
}

// slotStoreAdapter —— ConnectorRepo → connector.SlotStore（同品类的 active 连接器 id）。
type slotStoreAdapter struct{ repo *postgres.ConnectorRepo }

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

// registerDiscoveredConnectors —— 拉起时：内置 manifest 装配进 Hub + slot-backed 品类 dep 注册。
// 同 registerDiscoveredPlugins（MCP 插件）同构——host 不 import 任何具体连接器，契约只有数据。
func registerDiscoveredConnectors(
	ctx context.Context, d *runtimeDeps, depReg *capreg.DepRegistry,
) error {
	manifests, err := builtins.Load()
	if err != nil {
		return fmt.Errorf("load builtin connectors: %w", err)
	}
	hub := connector.NewHub()
	store := connectionStoreAdapter{repo: d.connectorRepo}
	smtpVault := smtpVaultAdapter{repo: d.connectorRepo}
	for i := range manifests {
		c, aerr := assembleConnector(&manifests[i], http.DefaultClient, store, smtpVault)
		if aerr != nil {
			return aerr
		}
		hub.Register(c)
	}
	if uerr := registerUploadedConnectors(ctx, hub, store, d.connectorRepo); uerr != nil {
		return uerr
	}
	d.connectorSlots = connector.NewSlots(hub, slotStoreAdapter{repo: d.connectorRepo})
	depReg.Register(capreg.NamedProvider("calendar", d.connectorSlots.Calendar().Connected))
	depReg.Register(capreg.NamedProvider("smtp", d.connectorSlots.Mail().Connected))
	return nil
}

// registerUploadedConnectors —— 拉起重装：DB 里 owner 上传的 openapi 连接器（存了 spec+binding）
// 装配进 Hub（跟内置同一路 AssembleOpenAPI）。
func registerUploadedConnectors(
	ctx context.Context, hub *connector.Hub,
	store connectionStoreAdapter, repo *postgres.ConnectorRepo,
) error {
	uploaded, err := repo.ListUploaded(ctx)
	if err != nil {
		return fmt.Errorf("load uploaded connectors: %w", err)
	}
	for i := range uploaded {
		u := &uploaded[i]
		m := &connector.Manifest{
			ID: u.ConnectorID, Kind: u.Kind, Category: u.Category,
			AuthScheme: u.AuthScheme, Spec: u.Spec, Binding: u.Binding,
		}
		c, aerr := connector.AssembleOpenAPI(m, http.DefaultClient, store)
		if aerr != nil {
			return fmt.Errorf("assemble uploaded connector %q: %w", u.ConnectorID, aerr)
		}
		hub.Upsert(c)
	}
	return nil
}

// uploadedInstaller —— connectorsvc.Installer：装配（校验）一份上传 manifest + 注册进 live Hub。
type uploadedInstaller struct {
	slots *connector.Slots
	store connectionStoreAdapter
	doer  *http.Client
}

func (i uploadedInstaller) Install(m *connector.Manifest) (string, error) {
	c, err := connector.AssembleOpenAPI(m, i.doer, i.store)
	if err != nil {
		return "", fmt.Errorf("assemble uploaded connector: %w", err)
	}
	cat, cerr := connector.BindingCategory(m)
	if cerr != nil {
		return "", fmt.Errorf("binding category: %w", cerr)
	}
	i.slots.Register(c)
	return cat, nil
}

// loadBuiltinConnectorManifests —— admin 路由要的内置 manifest（id→category/kind/spec）。
// 拉起时读一次（embed），失败 → 空（连接器 admin 面空，不挂整个 server）。
func loadBuiltinConnectorManifests(d *runtimeDeps) []connector.Manifest {
	manifests, err := builtins.Load()
	if err != nil {
		d.log.Error("load builtin connector manifests", "err", err)
		return []connector.Manifest{}
	}
	return manifests
}

// assembleConnector —— 按 kind 把一份 manifest 装配成 Connector（内置/上传同一路）。
func assembleConnector(
	m *connector.Manifest, doer *http.Client,
	store connector.ConnectionStore, smtpVault connector.SMTPVault,
) (connector.Connector, error) {
	switch m.Kind {
	case "openapi":
		c, err := connector.AssembleOpenAPI(m, doer, store)
		if err != nil {
			return nil, fmt.Errorf("assemble openapi connector: %w", err)
		}
		return c, nil
	case "protocol":
		return assembleProtocolConnector(m, smtpVault)
	default:
		return nil, fmt.Errorf("unknown connector kind %q for %q", m.Kind, m.ID)
	}
}

// assembleProtocolConnector —— protocol kind 按 Protocol 选内置实现。
func assembleProtocolConnector(
	m *connector.Manifest, smtpVault connector.SMTPVault,
) (connector.Connector, error) {
	if m.Protocol == "smtp" {
		return connector.NewSMTPConnector(m.ID, smtpVault), nil
	}
	return nil, fmt.Errorf("unknown protocol %q for connector %q", m.Protocol, m.ID)
}
