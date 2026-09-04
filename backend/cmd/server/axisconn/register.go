// register.go —— #155 composition root: wires connector machinery into the running system: Boot
// assembles built-in manifests into the Hub, vouches category deps via slot dispatcher, and
// ConnectorRepo satisfies ConnectionStore/SMTPVault/SlotStore via adapters (decryption inside).

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

// connectorEgressAllow —— outbound SSRF allowlist (CONNECTOR_EGRESS_ALLOW: comma-separated
// hostnames; e2e allows external-mock through, prod leaves it empty = blocks internal network).
func connectorEgressAllow() connector.EgressAllow {
	return connector.NewEgressAllow(strings.Split(os.Getenv("CONNECTOR_EGRESS_ALLOW"), ","))
}

// connectorEgressClient —— SSRF-guarded outbound client (allowed host passes, else blocked).
func connectorEgressClient() *http.Client {
	return connectorEgressAllow().GuardedHTTPClient()
}

// connectionStoreAdapter —— ConnectorRepo → connector.ConnectionStore (swaps arg order).
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

// SaveTokens —— writes back a silent oauth2 refresh (connector.TokenRefresh → storage).
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

// MarkDisconnected —— on revocation, clears token/connected/active; owner must reconnect.
func (a connectionStoreAdapter) MarkDisconnected(
	ctx context.Context, connectorID, ownerID string,
) error {
	if err := a.repo.ClearTokens(ctx, ownerID, connectorID); err != nil {
		return fmt.Errorf("connection store mark disconnected: %w", err)
	}
	return nil
}

// smtpCredJSON —— the JSON shape inside the smtp connector's credentials_enc.
type smtpCredJSON struct {
	Host        string `json:"host"`
	Port        string `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	FromAddress string `json:"from_address"`
	FromName    string `json:"from_name"`
	TLS         string `json:"tls"`
}

// smtpVaultAdapter —— ConnectorRepo → connector.SMTPVault (decodes the smtp config JSON).
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
		port = 0 // parse failed → 0, fails at connect time (graceful degradation)
	}
	return connector.SMTPConfig{
		Host: c.Host, Port: port, Username: c.Username, Password: c.Password,
		FromAddress: c.FromAddress, FromName: c.FromName, TLS: c.TLS,
	}, nil
}

// caldavCredJSON —— JSON shape in caldav connector's credentials_enc (owner url/user/pass).
type caldavCredJSON struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// caldavVaultAdapter —— ConnectorRepo → connector.CalDAVVault (decodes caldav config JSON).
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

// slotStoreAdapter —— ConnectorRepo → connector.SlotStore (active connector id per category).
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

// EnsureConnectorSlots —— stands up Hub+Slots (needs ConnectorRepo), before
// buildPluginRegistry captures it (nil there panics later). Idempotent: reuses hub.
func EnsureConnectorSlots(d *deps.Runtime) {
	if d.ConnectorSlots != nil {
		return
	}
	d.ConnectorHub = connector.NewHub()
	d.ConnectorSlots = connector.NewSlots(d.ConnectorHub, slotStoreAdapter{repo: d.ConnectorRepo})
	// a background call's failure needs somewhere to go, or it's silent
	d.ConnectorSlots.SetLogger(d.Log)
}

// RegisterDiscoveredConnectors —— boot: assembles manifests into Hub, registers category deps.
// Isomorphic with RegisterDiscoveredPlugins — host imports no connector; contract is data only.
func RegisterDiscoveredConnectors(
	ctx context.Context, d *deps.Runtime, depReg *capreg.DepRegistry,
) error {
	manifests, err := connectors.Load()
	if err != nil {
		return fmt.Errorf("load builtin connectors: %w", err)
	}
	// hub already stood up by ensureConnectorSlots (captured by owner-MCP deps); reuse it.
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
	// NamedOpProvider: beyond "connected" it answers "can this grant do action X" (manifest names
	// it `calendar:events.insert`), so read-only stops "book a meeting" not "free slots" (F-B-8).
	depReg.Register(capreg.NamedOpProvider(
		"calendar",
		d.ConnectorSlots.Calendar().Connected,
		func(ctx context.Context, ownerID, op string) (bool, error) {
			return d.ConnectorSlots.CanPerform(ctx, ownerID, "calendar", op)
		},
	))
	depReg.Register(capreg.NamedProvider("smtp", d.ConnectorSlots.Mail().Connected))
	registerUploadedConnectors(ctx, hub, d.ConnectorRepo, adeps, d.Log)
	return nil
}

// uploadedInstaller —— Installer: assembles + registers a self-built manifest into the Hub.
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

// AgentConnectorSource —— owner's opted-in, connected connectors for visitor use, via Hub.
type AgentConnectorSource struct {
	repo  *connector.Repo
	slots *connector.Slots
}

// NewAgentConnectorSource —— the owner's connected connectors that are opted in as agent tools.
func NewAgentConnectorSource(d *deps.Runtime) *AgentConnectorSource {
	return &AgentConnectorSource{repo: d.ConnectorRepo, slots: d.ConnectorSlots}
}

// AgentConnectors —— the connectors the owner has connected and opted in as agent tools.
func (s *AgentConnectorSource) AgentConnectors(
	ctx context.Context, ownerID string,
) ([]consumer.AgentToolConnector, error) {
	conns, err := s.repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list connectors for agent tools: %w", err)
	}
	return s.slots.AgentConnectorsByID(connectedIDs(conns)), nil
}

// connectedIDs —— ids of connected connectors (agent-tools gate: unconnected is never exposed).
func connectedIDs(conns []connector.Connection) []string {
	out := make([]string, 0, len(conns))
	for i := range conns {
		if conns[i].Connected {
			out = append(out, conns[i].ConnectorID)
		}
	}
	return out
}

// manifestCategory —— openapi's category comes from Binding; protocol uses declared Category.
func manifestCategory(m *connector.Manifest) (string, error) {
	if m.Kind == "protocol" {
		return m.Category, nil
	}
	if len(m.Binding) == 0 {
		// agent-only openapi connector (§3): no category binding, occupies no category slot
		return "", nil
	}
	cat, cerr := connector.BindingCategory(m)
	if cerr != nil {
		return "", fmt.Errorf("binding category: %w", cerr)
	}
	return cat, nil
}

// assembleDeps —— dependencies to assemble one connector (openapi and protocol share the set).
type assembleDeps struct {
	doer          *http.Client
	store         connectionStoreAdapter
	smtpVault     smtpVaultAdapter
	caldavVault   caldavVaultAdapter
	telegramVault telegramVaultAdapter
	allow         connector.EgressAllow
}

func newAssembleDeps(repo *connector.Repo) *assembleDeps {
	allow := connectorEgressAllow()
	return &assembleDeps{
		doer:          allow.GuardedHTTPClient(),
		store:         connectionStoreAdapter{repo: repo},
		smtpVault:     smtpVaultAdapter{repo: repo},
		caldavVault:   caldavVaultAdapter{repo: repo},
		telegramVault: telegramVaultAdapter{repo: repo},
		allow:         allow,
	}
}

// loadBuiltinConnectorManifests —— admin's manifests; embedded, empty on failure (non-fatal).
func loadBuiltinConnectorManifests(d *deps.Runtime) []connector.Manifest {
	manifests, err := connectors.Load()
	if err != nil {
		d.Log.Error("load builtin connector manifests", "err", err)
		return []connector.Manifest{}
	}
	return manifests
}

// assembleConnector —— builds a Connector from a manifest by kind; built-in/uploaded share it.
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

// assembleProtocolConnector —— for protocol kind, picks built-in impl by Protocol (smtp/caldav).
func assembleProtocolConnector(
	m *connector.Manifest, d *assembleDeps,
) (connector.Connector, error) {
	switch m.Protocol {
	case "smtp":
		return connector.NewSMTPConnector(m.ID, d.smtpVault), nil
	case "caldav":
		return connector.NewCalDAVConnector(m.ID, d.caldavVault, d.doer), nil
	case "telegram":
		return connector.NewTelegramConnector(m.ID, d.telegramVault), nil
	default:
		return nil, fmt.Errorf("unknown protocol %q for connector %q", m.Protocol, m.ID)
	}
}
