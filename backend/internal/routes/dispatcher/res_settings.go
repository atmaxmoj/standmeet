// res_settings.go —— 资源 settings:owner 的推理设置。两块合在一起,因为它们回**同一份载荷**:
//
//	ai      owner 自己的推理 provider(endpoint / model / 有没有配 key)
//	byoai   没有邀请码的访客自带 key 时,允许用哪些 provider、页面上写什么
//
// 分开搬会留下两份"设置长什么样",而它们本来就是一个信封的两半。
//
// 迁移时发现一处**同一个面内部**的不一致:GET /me 回的 ai 里有 endpoint 和 model,
// 但 PUT /byoai、PATCH /ai-provider 回的那份没有 —— 前端拿响应往缓存里一换,
// 这两个字段就被抹成空。现在只有一份构造,不存在"某条路径少填两个字段"。
//
// ai 的写入带**明文 API key**,所以它是写下来的单面决定:只在 admin 上。
// MCP 是纯 JSON 工具面,不该承载原始密钥。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// SettingsStore —— settings 这组操作所需的最小口。
type SettingsStore interface {
	SetBYOAI(ctx context.Context, in *WriteBYOAI) (Settings, error)
	SetAIProvider(ctx context.Context, in *WriteAIProvider) (Settings, error)
	AIPresets() []AIPreset
}

// SettingsResource —— settings 资源:byoai.set / ai_provider.set / ai_provider.presets。
// 叫 SettingsResource 而不是 Settings,是因为 Settings 已经是载荷类型的名字。
func SettingsResource(store SettingsStore) Resource {
	return Resource{Name: "settings", Ops: []Op{
		{
			ID: "byoai.set",
			Description: "Set BYOAI settings (enabled, allowed providers, public blurb) for " +
				"uninvited visitors who bring their own API key.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"enabled":{"type":"boolean"},
					"providers":{"type":"array","items":{"type":"string"}},
					"blurb":{"type":"string"}
				},
				"required":["enabled"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: settingsSetBYOAI(store),
		},
		{
			ID: "ai_provider.set",
			Description: "Set the owner's chat inference provider: endpoint, model, and the " +
				"API key itself (encrypted at rest; never returned).",
			InputSchema: aiProviderSchema,
			Kind:        fp.Action,
			Reach:       fp.Only("sets a raw provider API key", "admin"),
			Invoke:      settingsSetAIProvider(store),
		},
		{
			ID: "ai_provider.presets",
			Description: "List the built-in AI provider presets (name, label, base_url, " +
				"key_prefix) for configuring the owner's chat inference provider.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      settingsAIPresets(store),
		},
	}}
}

var aiProviderSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"provider":{"type":"string","description":"Preset name, or a self-hosted label."},
		"endpoint":{"type":"string","description":"Base URL (preset default, or required)."},
		"model":{"type":"string","description":"Model id (preset default, or overridden)."},
		"key_change":{"type":"string","description":"'keep' | 'set' | 'clear'."},
		"key":{"type":"string","description":"The API key; only read when key_change='set'."}
	}
}`)

// settingsOut —— 出站载荷形状(两个写操作回同一份;GET /me 里嵌的也是它)。
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

func toSettingsOut(s *Settings) settingsOut {
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

func settingsSetBYOAI(store SettingsStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in byoaiArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		s, err := store.SetBYOAI(ctx, &WriteBYOAI{
			OwnerID: ownerID, Enabled: in.Enabled,
			Providers: nonNilStrings(in.Providers), Blurb: in.Blurb,
		})
		if err != nil {
			return nil, fmt.Errorf("update byoai: %w", err)
		}
		return marshalOut(toSettingsOut(&s))
	}
}

type aiProviderArgs struct {
	Provider  string `json:"provider"`
	Endpoint  string `json:"endpoint"`
	Model     string `json:"model"`
	KeyChange string `json:"key_change"`
	Key       string `json:"key"`
}

func settingsSetAIProvider(store SettingsStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in aiProviderArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		s, err := store.SetAIProvider(ctx, &WriteAIProvider{
			OwnerID: ownerID, Provider: in.Provider, Endpoint: in.Endpoint,
			Model: in.Model, KeyChange: in.KeyChange, Key: in.Key,
		})
		if err != nil {
			return nil, fmt.Errorf("update ai provider: %w", err)
		}
		return marshalOut(toSettingsOut(&s))
	}
}

type aiPresetOut struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	BaseURL   string `json:"base_url"`
	KeyPrefix string `json:"key_prefix"`
}

func settingsAIPresets(store SettingsStore) Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		presets := store.AIPresets()
		out := make([]aiPresetOut, 0, len(presets))
		for i := range presets {
			out = append(out, aiPresetOut{
				Name: presets[i].Name, Label: presets[i].Label,
				BaseURL: presets[i].BaseURL, KeyPrefix: presets[i].KeyPrefix,
			})
		}
		return marshalOut(out)
	}
}
