// Package ops —— what the owner domain can do externally, declared by the domain itself.
//
// An operation is one complete unit here: id, description, input schema, semantic kind,
// exposure intent, implementation. The implementation calls this domain's use case directly,
// with no intermediate shape in between — the convergence point only aggregates, decorates,
// and projects onto each face.
package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Domains —— the custom-domain whitelist for on-demand TLS: list / add / remove.
//
// The actual DNS / TLS verification goes through Caddy's on-demand callback; this only
// maintains that whitelist. It's an **instance-level** setting (single-owner instance), so
// the domain functions don't take an ownerID — this layer swallows it so every op's
// signature stays consistent at the convergence point.
func Domains(deps usecase.AllowedDomainsDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "domains.list",
			Description: "List the custom domains allowed for on-demand TLS.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listDomains(deps),
		},
		{
			ID: "domains.add",
			Description: "Allow a custom domain for on-demand TLS. Scheme and trailing " +
				"slash are normalized off.",
			InputSchema: domainSchema("Domain to allow, e.g. me.example.com"),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mutateDomain(deps, usecase.AddAllowedDomain),
		},
		{
			ID:          "domains.remove",
			Description: "Stop allowing a custom domain. Idempotent.",
			InputSchema: domainSchema("Domain to remove."),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mutateDomain(deps, usecase.RemoveAllowedDomain),
		},
	}
}

var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// nonNilStrings —— a nil slice serializes to null; callers want [].
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func domainSchema(desc string) json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{"domain":{"type":"string","description":"` + desc + `"}},
		"required":["domain"]
	}`)
}

type domainArgs struct {
	Domain string `json:"domain"`
}

func listDomains(deps usecase.AllowedDomainsDeps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := usecase.ListAllowedDomains(ctx, deps)
		if err != nil {
			return nil, fp.OpErr("list allowed domains", err)
		}
		return json.Marshal(map[string][]string{"domains": list})
	}
}

// mutateDomain —— add and remove differ only in which use case gets called; decoding,
// validation, and reply shape are all the same.
func mutateDomain(
	deps usecase.AllowedDomainsDeps,
	apply func(ctx context.Context, deps usecase.AllowedDomainsDeps, domain string) error,
) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in domainArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"domain", in.Domain}); err != nil {
			return nil, err
		}
		if err := apply(ctx, deps, in.Domain); err != nil {
			return nil, domainErr(err)
		}
		return json.Marshal(in)
	}
}

// domainErr —— the domain saying "this field is empty" (including becoming empty only
// after normalizing) is, externally, the caller having given a bad value.
func domainErr(err error) error {
	if errors.Is(err, apierr.ErrEmptyField) {
		return fp.BadInput("domain is required")
	}
	return fp.OpErr("mutate allowed domain", err)
}
