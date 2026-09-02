// providers.go —— the outward-facing set of operations on the owner's provider book.
//
// **The create/update-key ops are panel-only** (fp.Only "carries a raw provider API key"),
// same reason as ai_provider.set next door: they carry a raw secret, and MCP is a pure JSON
// tool face that doesn't carry that. List / set-default / delete don't touch the key, so
// both faces get them.
//
// The outbound struct **has no key field at all** — not "remember not to write it", it
// simply doesn't exist, so no face can leak it.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// ProvidersDeps —— the dependencies this group needs.
type ProvidersDeps struct {
	Providers usecase.ProvidersDeps
	// ModelLister —— asks a given provider which models it offers (F-R-11). A port,
	// not a repository: the key is stored encrypted and this side never decrypts it;
	// the implementation lives at the assembly root. nil = this instance lacks the
	// capability, and that's stated rather than pretending the question was asked.
	ModelLister usecase.ProviderModelLister
}

// Providers —— providers.list / create / update / set_default / delete.
func Providers(d ProvidersDeps) []fp.Op {
	return append([]fp.Op{
		{
			ID: "providers.list",
			Description: "List the owner's inference providers (label, provider, endpoint, " +
				"model, whether a key is set, which one is the default, remaining gas).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listProviders(d),
		},
		{
			ID: "providers.set_default",
			Description: "Make one provider the default — the one used when neither the " +
				"access code nor the role names another.",
			InputSchema: providerIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setDefaultProvider(d),
		},
		{
			ID: "providers.list_models",
			Description: "Ask a configured provider which models it offers, using the key " +
				"already stored for it. Omit id for the default provider. Returns model " +
				"names only — never the key.",
			InputSchema: providerModelsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listProviderModels(d.ModelLister),
		},
		{
			ID: "providers.delete",
			Description: "Delete a provider. Codes and roles pointing at it fall back to the " +
				"default; the default itself cannot be deleted.",
			InputSchema: providerIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteProvider(d),
		},
	}, providerWriteOps(d)...)
}

// providerWriteOps —— the two ops that carry a plaintext key, panel-only.
func providerWriteOps(d ProvidersDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "providers.create",
			Description: "Add a provider to the owner's book: label, provider preset, " +
				"endpoint, model, and the API key itself (encrypted at rest, never returned).",
			InputSchema: providerCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.Only("carries a raw provider API key", "admin"),
			Invoke:      createProvider(d),
		},
		{
			ID: "providers.update",
			Description: "Change a provider's label / preset / endpoint / model, or set its " +
				"gas tank (tokens; null = unmetered).",
			InputSchema: providerUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateProvider(d),
		},
	}
}

var (
	providerIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"Provider id."}},
		"required":["id"]
	}`)

	providerCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"label":{"type":"string","description":"The owner's name for this entry."},
			"provider":{"type":"string","description":"Preset name, or 'custom' for self-hosted."},
			"endpoint":{"type":"string","description":"Base URL (preset default, or required)."},
			"model":{"type":"string","description":"Model id."},
			"key":{"type":"string","description":"The API key."},
			"is_default":{"type":"boolean","description":"Make this the default entry."}
		},
		"required":["label","provider"]
	}`)

	providerUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string"},
			"label":{"type":"string"},
			"provider":{"type":"string"},
			"endpoint":{"type":"string"},
			"model":{"type":"string"},
			"gas_tokens":{"type":["integer","null"],
				"description":"Remaining tokens on this tank; null = unmetered."}
		},
		"required":["id"]
	}`)
)

// providerOut —— outbound shape. **No key**.
//
// gas_tokens is how much was topped up, gas_remaining is how much is left (derived on read).
// Both are sent: reporting only what's left, the owner can't tell how big the tank started;
// reporting only the top-up, "how much longer can I chat" is left for him to calculate.
type providerOut struct {
	GasTokens     *int64 `json:"gas_tokens"`
	GasRemaining  *int64 `json:"gas_remaining"`
	ID            string `json:"id"`
	Label         string `json:"label"`
	Provider      string `json:"provider"`
	Endpoint      string `json:"endpoint"`
	Model         string `json:"model"`
	KeyConfigured bool   `json:"key_configured"`
	IsDefault     bool   `json:"is_default"`
}

func providerPayload(p *repo.ProviderRow, remaining *int64) providerOut {
	return providerOut{
		ID: p.ID, Label: p.Label, Provider: p.Provider, Endpoint: p.Endpoint,
		Model: p.Model, KeyConfigured: p.KeyConfigured, IsDefault: p.IsDefault,
		GasTokens: p.GasTokens, GasRemaining: remaining,
	}
}

func listProviders(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListProviders(ctx, d.Providers, ownerID)
		if err != nil {
			return nil, providerErr("list providers", err)
		}
		out := make([]providerOut, 0, len(rows))
		for i := range rows {
			out = append(out, providerPayload(&rows[i].Row, rows[i].Remaining))
		}
		return json.Marshal(out)
	}
}

type providerCreateArgs struct {
	Label     string `json:"label"`
	Provider  string `json:"provider"`
	Endpoint  string `json:"endpoint"`
	Model     string `json:"model"`
	Key       string `json:"key"`
	IsDefault bool   `json:"is_default"`
}

func createProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in providerCreateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		row, cerr := usecase.CreateProvider(ctx, d.Providers, &usecase.CreateProviderInput{
			OwnerID: ownerID, Label: in.Label, Provider: in.Provider,
			Endpoint: in.Endpoint, Model: in.Model, Key: in.Key, IsDefault: in.IsDefault,
		})
		if cerr != nil {
			return nil, providerErr("create provider", cerr)
		}
		return marshalProvider(ctx, d, &row)
	}
}

// marshalProvider —— one entry + its gas-gauge reading. Reads the gauge immediately after a
// write: what the owner sees right after topping up is the exact number the gate enforces,
// not a guess the frontend computes from the top-up amount.
func marshalProvider(
	ctx context.Context, d ProvidersDeps, row *repo.ProviderRow,
) (json.RawMessage, error) {
	left, err := usecase.ProviderRemaining(ctx, d.Providers.Spend, row)
	if err != nil {
		return nil, providerErr("read provider gas", err)
	}
	payload := providerPayload(row, left)
	return json.Marshal(payload)
}

// providerUpdateArgs —— a partial update: fields are pointers, not given = unchanged.
// GasTokens is three-state: not given = unchanged; null = drop metering; a number = set the
// tank to that amount.
type providerUpdateArgs struct {
	Label     *string `json:"label"`
	Provider  *string `json:"provider"`
	Endpoint  *string `json:"endpoint"`
	Model     *string `json:"model"`
	GasTokens *int64  `json:"gas_tokens"`
	ID        string  `json:"id"`
}

func updateProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseProviderUpdate(raw)
		if perr != nil {
			return nil, perr
		}
		row, uerr := usecase.UpdateProvider(ctx, d.Providers, &repo.UpdateProviderInput{
			OwnerID: ownerID, ID: in.ID, Label: in.Label, Provider: in.Provider,
			Endpoint: in.Endpoint, Model: in.Model,
			SetGas: rawHasKey(raw, "gas_tokens"), GasTokens: in.GasTokens,
		})
		if uerr != nil {
			return nil, providerErr("update provider", uerr)
		}
		return marshalProvider(ctx, d, &row)
	}
}

func parseProviderUpdate(raw json.RawMessage) (providerUpdateArgs, error) {
	var in providerUpdateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"id", in.ID})
}

// rawHasKey —— whether this key **was present at all** (not whether its value is null). The
// gas field is three-state: not-given and given-as-null are two different things — the
// former leaves it unchanged, the latter drops metering.
func rawHasKey(raw json.RawMessage, key string) bool {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return false
	}
	_, ok := probe[key]
	return ok
}

func setDefaultProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseProviderID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.SetDefaultProvider(ctx, d.Providers, ownerID, id); err != nil {
			return nil, providerErr("set default provider", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

func deleteProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseProviderID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeleteProvider(ctx, d.Providers, ownerID, id); err != nil {
			return nil, providerErr("delete provider", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

func parseProviderID(raw json.RawMessage) (string, error) {
	var in struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.ID, fp.RequireArgs([2]string{"id", in.ID})
}

// providerErr —— translates domain sentinels into categories the convergence point
// recognizes. Deleting the default is a **conflict**, not bad input: the owner didn't get
// anything wrong, this action conflicts with "there must always be one to fall back to" —
// the frontend prompts inline on the 409.
func providerErr(what string, err error) error {
	switch {
	case errors.Is(err, entity.ErrProviderIsDefault):
		return fp.Coded(fp.Conflict(
			"this is the default provider — make another one the default first"),
			"provider_is_default")
	case errors.Is(err, entity.ErrProviderNotFound):
		return fp.NotFound("no such provider")
	default:
		return fp.OpErr(what, err)
	}
}
