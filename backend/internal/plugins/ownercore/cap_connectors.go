package ownercore

// cap_connectors.go —— owner-side connector-management Capability. Mirrors the
// admin /api/admin/connectors panel over owner MCP: list / catalog / status
// (reads) + create / update / delete / activate / disconnect / validate_spec /
// mail_test_send (actions). owner-only; hidden from visitor assembly.
//
// The connector orchestration itself lives in internal/connectorsvc (fetch /
// install / persist / oauth). This Capability holds only a narrow interface over
// that service (domain + local DTO types, no postgres/connectorsvc coupling) so
// the composition root wires it through a thin adapter. Action tools live in
// cap_connectors_more.go.

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

const capConnectorsBundle = "connectors.bundle"

// ───── narrow deps ──────────────────────────────────────────────

// UploadedSpecArg —— create/update payload for an openapi connector (spec +
// JSONata binding + selected auth scheme + agent-tools flag). Mirrors
// connectorsvc.UploadedSpec without importing it; the wiring adapter maps across.
type UploadedSpecArg struct {
	AuthScheme         string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}

// SpecVerdict —— validate-spec result (candidate title or human-readable reason +
// derived auth forms). Mirrors connectorsvc.SpecVerdict; Auth is passed through
// opaquely (schemaless MCP payload).
type SpecVerdict struct {
	Auth   any
	Title  string
	Reason string
	OK     bool
}

// connectorService —— the connector orchestration surface this Capability needs.
// Kept to domain + local DTO types so ownercore stays free of postgres/connectorsvc
// imports; the composition root supplies an adapter over *connectorsvc.Service.
type connectorService interface {
	List(ctx context.Context, ownerID string) ([]connector.Connection, error)
	Catalog() []connector.Connection
	Status(ctx context.Context, ownerID, id string) (connector.Connection, error)
	CreateProtocol(ctx context.Context, ownerID, category, protocol string) (string, error)
	CreateUploaded(ctx context.Context, ownerID string, in UploadedSpecArg) (string, error)
	UpdateUploaded(ctx context.Context, ownerID, id string, in UploadedSpecArg) error
	Delete(ctx context.Context, ownerID, id string) error
	Activate(ctx context.Context, ownerID, id string) error
	Disconnect(ctx context.Context, ownerID, id string) error
	ValidateSpec(ctx context.Context, spec []byte, url string) SpecVerdict
}

// ConnectorsOwnerDeps —— newConnectorsCapability 入参打包。Svc is the connector
// orchestration surface; Mail sends a test message through the active mail
// connector; MailKind reports which mail kind actually served it.
type ConnectorsOwnerDeps struct {
	Svc      connectorService
	Mail     contract.MailProxy
	MailKind func(ctx context.Context, ownerID string) string
}

type connectorsCapability struct {
	deps *ConnectorsOwnerDeps
	log  *slog.Logger
}

func newConnectorsCapability(
	deps *ConnectorsOwnerDeps, log *slog.Logger,
) *connectorsCapability {
	return &connectorsCapability{deps: deps, log: log}
}

func (*connectorsCapability) ID() string          { return capConnectorsBundle }
func (*connectorsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*connectorsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*connectorsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*connectorsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *connectorsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listBinding(), c.catalogBinding(), c.statusBinding(),
		c.createBinding(), c.updateBinding(), c.deleteBinding(),
		c.activateBinding(), c.disconnectBinding(),
		c.validateSpecBinding(), c.mailTestSendBinding(),
	}
}

// ───── wire view ────────────────────────────────────────────────

// connectorRow —— MCP wire view of a connector connection (mirrors the admin
// connectorStatusResp): id / category / kind + credential/connect/active flags.
type connectorRow struct {
	ID             string `json:"id"`
	Category       string `json:"category"`
	Kind           string `json:"kind"`
	HasCredentials bool   `json:"has_credentials"`
	Connected      bool   `json:"connected"`
	Active         bool   `json:"active"`
}

func connectorStatusRow(c *connector.Connection) connectorRow {
	return connectorRow{
		ID: c.ConnectorID, Category: c.Category, Kind: c.Kind,
		HasCredentials: len(c.Credentials) > 0,
		Connected:      c.Connected, Active: c.Active,
	}
}

func connectorRows(conns []connector.Connection) []connectorRow {
	rows := make([]connectorRow, 0, len(conns))
	for i := range conns {
		rows = append(rows, connectorStatusRow(&conns[i]))
	}
	return rows
}

// idArgs —— shared single-{id} argument shape (status / delete / activate /
// disconnect).
type idArgs struct {
	ID string `json:"id"`
}

func parseIDArgs(raw json.RawMessage) (idArgs, error) {
	var args idArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, wrapArgs(err)
	}
	if args.ID == "" {
		return args, errIDRequired
	}
	return args, nil
}

// ───── connectors.list ──────────────────────────────────────────

func (c *connectorsCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.list",
		Description: "List the owner's configured connectors with their category, " +
			"kind, and credential / connected / active state.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

func (c *connectorsCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	conns, err := c.deps.Svc.List(ctx, ownerID)
	if err != nil {
		c.log.Error("cap connectors.list", "err", err)
		return capreg.MCPError("connectors.list failed")
	}
	return mcputil.MarshalResult(c.log, "connectors.list", connectorRows(conns))
}

// ───── connectors.catalog ───────────────────────────────────────

func (c *connectorsCapability) catalogBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.catalog",
		Description: "List the built-in connectors available to connect (id / " +
			"category / kind); fetch per-connector status and credential forms separately.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleCatalog,
	}
}

func (c *connectorsCapability) handleCatalog(
	_ context.Context, _ string, _ json.RawMessage,
) capreg.MCPResult {
	return mcputil.MarshalResult(
		c.log, "connectors.catalog", connectorRows(c.deps.Svc.Catalog()),
	)
}

// ───── connectors.status ────────────────────────────────────────

func (c *connectorsCapability) statusBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "connectors.status",
		Description: "Read a single connector's status (category / kind + flags).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Connector id."}
			},
			"required":["id"]
		}`),
		Handler: c.handleStatus,
	}
}

func (c *connectorsCapability) handleStatus(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseIDArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	conn, err := c.deps.Svc.Status(ctx, ownerID, args.ID)
	if err != nil {
		c.log.Error("cap connectors.status", "err", err)
		return capreg.MCPError("connectors.status failed")
	}
	return mcputil.MarshalResult(c.log, "connectors.status", connectorStatusRow(&conn))
}

// ───── connectors.mail_test_send ────────────────────────────────

type mailTestSendArgs struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

func parseMailTestSendArgs(raw json.RawMessage) (mailTestSendArgs, error) {
	var args mailTestSendArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, wrapArgs(err)
	}
	return args, nil
}

func (c *connectorsCapability) mailTestSendBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.mail_test_send",
		Description: "Send a test email through the active mail connector. Reports the " +
			"mail kind that served it (proves the mailer is kind-agnostic).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"to":{"type":"string","description":"Recipient address."},
				"subject":{"type":"string","description":"Message subject."},
				"text":{"type":"string","description":"Message body (plain text)."}
			},
			"required":["to"]
		}`),
		Handler: c.handleMailTestSend,
	}
}

func (c *connectorsCapability) handleMailTestSend(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseMailTestSendArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	serr := c.deps.Mail.Send(ctx, ownerID,
		contract.MailMessage{To: args.To, Subject: args.Subject, Body: args.Text})
	if serr != nil {
		// Test-send failure is expected-ish (SMTP down / bad creds); log for ops, report ok:false.
		c.log.Warn("cap connectors.mail_test_send", "err", serr)
		return mcputil.MarshalResult(c.log, "connectors.mail_test_send", map[string]any{
			"ok": false,
		})
	}
	return mcputil.MarshalResult(c.log, "connectors.mail_test_send", map[string]any{
		"ok": true, "via_kind": c.deps.MailKind(ctx, ownerID),
	})
}
