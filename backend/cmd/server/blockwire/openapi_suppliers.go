// openapi_suppliers.go — openapi suppliers run their calls in a sandbox block, never in-host.
//
// google-calendar ships its own block (its spec baked in). Every other openapi supplier — the ones
// an owner uploads, and the built-in bearer-api — runs on the shared openapi block: one node engine
// (infra/plugins/openapi) that reads the supplier's spec + binding from each call. The host keeps
// what needs the host (adapters.OpenAPIBehavior: connection row, scope shortfall, OAuth refresh,
// auth resolution) and hands the block the rest through the opaque credential blob.

package blockwire

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockseam"
)

// kindOpenAPI — what an openapi supplier reports as its wire (the mail receipt's "sent via").
const kindOpenAPI = plugin.TransportOpenAPI

// openapiVault — the opaque credential blob an openapi supplier's block receives on every call:
// the owner's auth as headers/query (resolved host-side, OAuth refreshed), the base URL, the
// internal hosts the owner allowed (the block refuses every other internal address), and — for the
// shared block — the supplier's own spec and binding.
type openapiVault struct {
	beh            *adapters.OpenAPIBehavior
	hosts          func() []string
	withDefinition bool
}

// openapiCallCreds — the blob's shape; the keys are the engine's CONN schema.
type openapiCallCreds struct {
	AuthHeaders map[string]string `json:"auth_headers"`
	AuthQuery   map[string]string `json:"auth_query"`
	BaseURL     string            `json:"base_url"`
	Spec        string            `json:"spec,omitempty"`
	Binding     string            `json:"binding,omitempty"`
	AllowHosts  []string          `json:"allow_hosts"`
}

func (v openapiVault) Connected(ctx context.Context, _, ownerID string) (bool, error) {
	return v.beh.Connected(ctx, ownerID)
}

func (v openapiVault) Credentials(
	ctx context.Context, _, ownerID string,
) (json.RawMessage, error) {
	a, err := v.beh.AuthFor(ctx, ownerID)
	if err != nil {
		return nil, v.authErr(err)
	}
	creds := openapiCallCreds{
		AuthHeaders: a.Headers, AuthQuery: a.Query, BaseURL: a.BaseURL, AllowHosts: v.allowHosts(),
	}
	if v.withDefinition {
		creds.Spec, creds.Binding = v.beh.SpecText(), v.beh.BindingText()
	}
	return json.Marshal(creds)
}

// authErr — a host-side refresh that came back invalid_grant means the owner revoked the grant on
// the provider. For a calendar, surface the revoked sentinel so the owner is told to reconnect
// (and the card drops "connected"), not "try again later". (The API-side 401, token still valid,
// is [fault:revoked] in the block engine.)
func (v openapiVault) authErr(err error) error {
	if errors.Is(err, adapters.ErrInvalidGrant) && v.beh.Seam() == "calendar" {
		return fmt.Errorf("%w: %w", adapters.ErrCalendarRevoked, err)
	}
	return err
}

// allowHosts — the owner's allowed internal hosts, never null on the wire.
func (v openapiVault) allowHosts() []string {
	if v.hosts == nil {
		return []string{}
	}
	if h := v.hosts(); h != nil {
		return h
	}
	return []string{}
}

// openapiAgent — the agent-tool half of an openapi supplier (§3): metadata from the spec, the call
// through the block's raw_call verb.
type openapiAgent struct {
	beh   *adapters.OpenAPIBehavior
	calls *blockseam.Provider
}

// rawCallArgs — the raw_call verb's arguments.
type rawCallArgs struct {
	OpID string          `json:"op_id"`
	Args json.RawMessage `json:"args,omitempty"`
}

func (a openapiAgent) ExposesAgentTools() bool      { return a.beh.ExposesAgentTools() }
func (a openapiAgent) AgentOps() []adapters.AgentOp { return a.beh.AgentOps() }

// CallAgentOp — one spec operation by operationId with this owner's auth; the raw response back.
func (a openapiAgent) CallAgentOp(
	ctx context.Context, ownerID, opID string, argsJSON json.RawMessage,
) (json.RawMessage, error) {
	args, merr := json.Marshal(rawCallArgs{OpID: opID, Args: argsJSON})
	if merr != nil {
		return nil, merr
	}
	out, err := a.calls.CallVerb(ctx, ownerID, "raw_call", args)
	if err != nil {
		return nil, fmt.Errorf("supplier %q agent call: %w", a.beh.ID(), err)
	}
	return out, nil
}

// openapiCalendar — an openapi supplier that fills the calendar seam.
type openapiCalendar struct {
	*blockCalendarProxy
	openapiAgent
}

// Kind — openapi, whichever block runs the calls.
func (openapiCalendar) Kind() string { return kindOpenAPI }

// Verify — an api-key or bearer supplier is usable once its credential is saved; connecting runs
// no call. calendar.check is the owner's real round-trip.
func (openapiCalendar) Verify(context.Context, string) error { return nil }

// openapiMail — an openapi supplier that fills the mail seam.
type openapiMail struct {
	*blockMailProxy
	openapiAgent
}

func (openapiMail) Kind() string { return kindOpenAPI }

// Verify — as for the calendar: saving the key is what makes an HTTP mail API usable.
func (openapiMail) Verify(context.Context, string) error { return nil }

// CanPerform — may this owner's grant do this one operation (F-B-8).
func (m openapiMail) CanPerform(ctx context.Context, ownerID, opID string) (bool, error) {
	return m.beh.CanPerform(ctx, ownerID, opID)
}

// openapiAgentOnly — an openapi supplier with no binding: it fills no seam, it only offers its raw
// operations as agent tools.
type openapiAgentOnly struct{ openapiAgent }

func (a openapiAgentOnly) Name() string { return a.beh.ID() }
func (openapiAgentOnly) Kind() string   { return kindOpenAPI }

func (a openapiAgentOnly) Connected(ctx context.Context, ownerID string) (bool, error) {
	return a.beh.Connected(ctx, ownerID)
}

// sharedBlockSupplier — an openapi supplier on the shared openapi block, typed by its binding's
// seam.
func sharedBlockSupplier(
	beh *adapters.OpenAPIBehavior, hosts func() []string,
) (adapters.Supplier, error) {
	dial := plugin.OpenAPIRuntime(beh.ID())
	vault := openapiVault{beh: beh, hosts: hosts, withDefinition: true}
	agent := openapiAgent{beh: beh, calls: blockseam.New(&dial, vault, dialBlock)}
	switch beh.Seam() {
	case "":
		return openapiAgentOnly{agent}, nil
	case "calendar":
		return openapiCalendar{&blockCalendarProxy{
			vault: vault, seam: agent.calls, behavior: beh, id: beh.ID(),
		}, agent}, nil
	case "mail":
		mail := &blockMailProxy{vault: vault, seam: agent.calls, id: beh.ID()}
		return openapiMail{mail, agent}, nil
	default:
		return nil, fmt.Errorf("openapi supplier %q binds unknown seam %q", beh.ID(), beh.Seam())
	}
}
