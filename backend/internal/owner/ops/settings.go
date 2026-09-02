// settings.go —— the owner's inference settings. The two halves are combined here because
// they return **the same payload**:
//
//	ai      the owner's own inference provider (endpoint / model / whether a key is set)
//	byoai   which providers are allowed and what the public blurb says, when an uninvited
//	        visitor brings their own key
//
// Splitting them would leave two copies of "what settings look like", when they're really
// two halves of one envelope. During migration a **within-one-face** inconsistency turned
// up: the ai object GET /me returns has endpoint and model, but the ones PUT /byoai and
// PATCH /ai-provider return don't — the frontend swapping the response into its cache blanks
// both fields. Now there's a single constructor.
//
// The key goes in, never comes out: the domain accepts plaintext, encrypts it before it's
// written to disk, and the structure that comes back has only the boolean "is one set" —
// the outbound type simply has no key field, so no face can leak it. Writing ai carries a
// **plaintext key**, so that op is spelled out as panel-only.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// SettingsDeps —— the dependencies this group needs.
//
// Presets is filled in by the assembly root (the table lives in the inference package, and
// inference in turn depends on owner — the domain importing it directly would create a
// cycle). Another spot in the domain uses the same trick: ProviderValidator is a narrow
// port, not an import.
type SettingsDeps struct {
	BYOAI   usecase.BYOAIDeps
	AI      usecase.AIProviderDeps
	Presets []AIPreset
}

// AIPreset —— one built-in provider preset.
type AIPreset struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	BaseURL   string `json:"base_url"`
	KeyPrefix string `json:"key_prefix"`
}

// Settings —— byoai.set / ai_provider.set / ai_provider.presets。
func Settings(deps SettingsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "byoai.set",
			Description: "Set BYOAI settings — enabled, allowed providers, public blurb — " +
				"for uninvited visitors who bring their own API key.",
			InputSchema: byoaiSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setBYOAI(deps.BYOAI),
		},
		{
			ID: "ai_provider.set",
			Description: "Set the owner's chat inference provider: endpoint, model, and the " +
				"API key itself (encrypted at rest, never returned).",
			InputSchema: aiProviderSchema,
			Kind:        fp.Action,
			Reach:       fp.Only("carries a raw provider API key", "admin"),
			Invoke:      setAIProvider(deps.AI),
		},
		{
			ID: "ai_provider.presets",
			Description: "List the built-in AI provider presets (name, label, base_url, " +
				"key_prefix) used to configure the owner's inference provider.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listAIPresets(deps.Presets),
		},
	}
}

var (
	byoaiSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"enabled":{"type":"boolean"},
			"providers":{"type":"array","items":{"type":"string"}},
			"blurb":{"type":"string"}
		},
		"required":["enabled"]
	}`)

	aiProviderSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"provider":{"type":"string","description":"Preset name, or a self-hosted label."},
			"endpoint":{"type":"string","description":"Base URL (preset default, or required)."},
			"model":{"type":"string","description":"Model id (preset default, or overridden)."},
			"key_change":{"type":"string","description":"'keep' | 'set' | 'clear'."},
			"key":{"type":"string","description":"The API key; read only when key_change='set'."}
		}
	}`)
)

// settingsOut —— outbound shape. Both write ops return this; it's also what's embedded in
// GET /me.
type settingsOut struct {
	AI    aiSettingsOut    `json:"ai"`
	BYOAI byoaiSettingsOut `json:"byoai"`
}

type aiSettingsOut struct {
	Provider      string `json:"provider"`
	Endpoint      string `json:"endpoint"`
	Model         string `json:"model"`
	KeyConfigured bool   `json:"key_configured"`
}

type byoaiSettingsOut struct {
	PublicBlurb string   `json:"public_blurb"`
	Providers   []string `json:"providers"`
	Enabled     bool     `json:"enabled"`
}

// SettingsOut —— lets elsewhere in the same domain (me) reuse this one constructor, so a
// second copy of "what settings look like" never appears.
func settingsPayload(s *entity.Settings) settingsOut {
	providers := s.BYOAI.Providers
	if providers == nil {
		providers = []string{}
	}
	return settingsOut{
		AI: aiSettingsOut{
			Provider: s.AI.Provider, Endpoint: s.AI.Endpoint,
			Model: s.AI.Model, KeyConfigured: s.AI.KeyConfigured,
		},
		BYOAI: byoaiSettingsOut{
			Enabled: s.BYOAI.Enabled, Providers: providers,
			PublicBlurb: s.BYOAI.PublicBlurb,
		},
	}
}

type byoaiArgs struct {
	Blurb     string   `json:"blurb"`
	Providers []string `json:"providers"`
	Enabled   bool     `json:"enabled"`
}

func setBYOAI(deps usecase.BYOAIDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in byoaiArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		providers := in.Providers
		if providers == nil {
			providers = []string{}
		}
		s, err := usecase.UpdateBYOAI(ctx, deps, &usecase.UpdateBYOAIInputReq{
			OwnerID: ownerID, Enabled: in.Enabled, Providers: providers, Blurb: in.Blurb,
		})
		if err != nil {
			return nil, settingsErr(err)
		}
		return json.Marshal(settingsPayload(&s))
	}
}

type aiProviderArgs struct {
	Provider  string `json:"provider"`
	Endpoint  string `json:"endpoint"`
	Model     string `json:"model"`
	KeyChange string `json:"key_change"`
	Key       string `json:"key"`
}

func setAIProvider(deps usecase.AIProviderDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in aiProviderArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		s, err := usecase.UpdateOwnerAIProvider(ctx, deps, &usecase.UpdateOwnerAIProviderInput{
			OwnerID: ownerID, Provider: in.Provider, Endpoint: in.Endpoint,
			Model: in.Model, KeyChange: keyChangeOf(in.KeyChange), Key: in.Key,
		})
		if err != nil {
			return nil, settingsErr(err)
		}
		return json.Marshal(settingsPayload(&s))
	}
}

// keyChangeOf —— three-state string → the domain's enum. Anything unrecognized is treated
// as keep: omitting a field shouldn't turn into "clear the key".
func keyChangeOf(s string) usecase.KeyChange {
	switch s {
	case "set":
		return usecase.KeySet
	case "clear":
		return usecase.KeyClear
	default:
		return usecase.KeyKeep
	}
}

func listAIPresets(presets []AIPreset) fp.Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		if presets == nil {
			presets = []AIPreset{}
		}
		return json.Marshal(presets)
	}
}

// settingsErr —— owner not found = the identity this session points at is gone →
// Unauthed (the frontend redirects to login on it), not a 404.
func settingsErr(err error) error {
	switch {
	case errors.Is(err, entity.ErrOwnerNotFound):
		return fp.Unauthed("owner not found")
	case errors.Is(err, apierr.ErrEmptyField):
		return fp.BadInput(err.Error())
	}
	return fp.OpErr("settings op", err)
}
