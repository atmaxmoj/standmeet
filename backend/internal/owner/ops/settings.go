// settings.go —— owner 的推理设置。两块合在一起,因为它们回**同一份载荷**:
//
//	ai      owner 自己的推理 provider(endpoint / model / 有没有配 key)
//	byoai   没有邀请码的访客自带 key 时,允许用哪些 provider、页面上写什么
//
// 分开会留下两份"设置长什么样",而它们本来就是一个信封的两半。迁移时发现过一处**同一个面
// 内部**的不一致:GET /me 回的 ai 里有 endpoint 和 model,PUT /byoai、PATCH /ai-provider
// 回的那份没有 —— 前端拿响应换缓存,这两个字段就被抹空。现在只有一处构造。
//
// key 只进不出:域收明文、落盘前加密,回来的结构里只有"配没配"这个布尔 —— 出站类型压根
// 没有 key 字段,所以任何一个面都无从泄露它。写 ai 带**明文 key**,所以那一条写明只在面板。

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

// SettingsDeps —— 这一组要的依赖。
//
// Presets 由组装根填(那份表在 inference 包里,而 inference 反过来依赖 owner —— 域直接
// import 它会成环)。域里另一处也用同样的手法:ProviderValidator 是个窄口,不是 import。
type SettingsDeps struct {
	BYOAI   usecase.BYOAIDeps
	AI      usecase.AIProviderDeps
	Presets []AIPreset
}

// AIPreset —— 一个内建 provider 预设。
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

// settingsOut —— 出站形状。两个写操作回同一份;GET /me 里嵌的也是它。
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

// SettingsOut —— 给同域别处(me)复用同一份构造,避免第二份"设置长什么样"。
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

// keyChangeOf —— 三态字符串 → 域的枚举。认不出的一律当 keep:少发一个字段不该变成"把 key 清了"。
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

// settingsErr —— owner 不存在 = 这次会话指向的身份没了 → Unauthed(前端据此跳登录),不是 404。
func settingsErr(err error) error {
	switch {
	case errors.Is(err, entity.ErrOwnerNotFound):
		return fp.Unauthed("owner not found")
	case errors.Is(err, apierr.ErrEmptyField):
		return fp.BadInput(err.Error())
	}
	return fp.OpErr("settings op", err)
}
