package ownercore

// cap_domains.go —— owner allowed-domains (Caddy on-demand TLS whitelist)
// CRUD via Capability. 3 tools: domains.list / domains.add / domains.remove.
// owner-only. Mirrors /api/admin/allowed-domains (usecases.*AllowedDomain*).

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capDomainsBundle = "domains.bundle"

type domainsCapability struct {
	deps usecases.AllowedDomainsDeps
	log  *slog.Logger
}

func newDomainsCapability(
	deps usecases.AllowedDomainsDeps, log *slog.Logger,
) *domainsCapability {
	return &domainsCapability{deps: deps, log: log}
}

func (*domainsCapability) ID() string          { return capDomainsBundle }
func (*domainsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }

func (*domainsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*domainsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*domainsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *domainsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listBinding(), c.addBinding(), c.removeBinding(),
	}
}

// ───── domains.list ─────────────────────────────────────────────

func (c *domainsCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "domains.list",
		Description: "List the custom domains allowed for on-demand TLS.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

func (c *domainsCapability) handleList(
	ctx context.Context, _ string, _ json.RawMessage,
) capreg.MCPResult {
	list, err := usecases.ListAllowedDomains(ctx, c.deps)
	if err != nil {
		c.log.Error("cap domains.list", "err", err)
		return capreg.MCPError("list allowed domains failed")
	}
	return mcputil.MarshalResult(c.log, "domains.list", map[string][]string{
		"domains": list,
	})
}

// ───── domains.add ──────────────────────────────────────────────

func (c *domainsCapability) addBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "domains.add",
		Description: "Add a custom domain to the on-demand TLS whitelist. " +
			"scheme + trailing slash are normalized off.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"domain":{"type":"string","description":"Domain to allow, e.g. me.example.com"}
			},
			"required":["domain"]
		}`),
		Handler: c.handleAdd,
	}
}

type domainArgsWire struct {
	Domain string `json:"domain"`
}

func (c *domainsCapability) handleAdd(
	ctx context.Context, _ string, raw json.RawMessage,
) capreg.MCPResult {
	var args domainArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if err := usecases.AddAllowedDomain(ctx, c.deps, args.Domain); err != nil {
		return c.domainErrToResult("add", err)
	}
	return mcputil.MarshalResult(c.log, "domains.add", map[string]string{
		"domain": args.Domain,
	})
}

// ───── domains.remove ───────────────────────────────────────────

func (c *domainsCapability) removeBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "domains.remove",
		Description: "Remove a custom domain from the on-demand TLS whitelist. Idempotent.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"domain":{"type":"string","description":"Domain to remove."}
			},
			"required":["domain"]
		}`),
		Handler: c.handleRemove,
	}
}

func (c *domainsCapability) handleRemove(
	ctx context.Context, _ string, raw json.RawMessage,
) capreg.MCPResult {
	var args domainArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if err := usecases.RemoveAllowedDomain(ctx, c.deps, args.Domain); err != nil {
		return c.domainErrToResult("remove", err)
	}
	return mcputil.MarshalResult(c.log, "domains.remove", map[string]string{
		"domain": args.Domain,
	})
}

func (c *domainsCapability) domainErrToResult(op string, err error) capreg.MCPResult {
	if errors.Is(err, apierr.ErrEmptyField) {
		return capreg.MCPError("domain is required")
	}
	c.log.Error("cap domains."+op, "err", err)
	return capreg.MCPError(op + " allowed domain failed")
}
