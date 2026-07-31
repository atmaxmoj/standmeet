// wire_disp_settings.go —— owner 推理设置(ai + byoai)→ 出站收口的窄口。
//
// key 只进不出:域收明文、落盘前 AES-GCM 加密,回给收口的 Settings 里只有
// "配没配"这个布尔。收口那侧的类型压根没有 key 字段,所以任何一个面都无从泄露它。

package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type settingsOps struct {
	byoai owner.BYOAIDeps
	ai    owner.AIProviderDeps
}

func newSettingsOps(d *runtimeDeps) settingsOps {
	return settingsOps{
		byoai: owner.BYOAIDeps{Owners: d.ownerRepo},
		// Providers 不能漏:域用它校验 provider 名是不是已知 preset。
		// 少给这个字段不会编译报错,只会在第一次写入时 nil 解引用 —— 装配期的坑。
		ai: owner.AIProviderDeps{Owners: d.ownerRepo, Providers: inferenceProviders{}},
	}
}

func (a settingsOps) SetBYOAI(
	ctx context.Context, in *dispatcher.WriteBYOAI,
) (dispatcher.Settings, error) {
	s, err := owner.UpdateBYOAI(ctx, a.byoai, &owner.UpdateBYOAIInputReq{
		OwnerID: in.OwnerID, Enabled: in.Enabled,
		Providers: in.Providers, Blurb: in.Blurb,
	})
	if err != nil {
		return dispatcher.Settings{}, settingsErr(err)
	}
	return toDispatcherSettings(&s), nil
}

func (a settingsOps) SetAIProvider(
	ctx context.Context, in *dispatcher.WriteAIProvider,
) (dispatcher.Settings, error) {
	s, err := owner.UpdateOwnerAIProvider(ctx, a.ai, &owner.UpdateOwnerAIProviderInput{
		OwnerID: in.OwnerID, Provider: in.Provider, Endpoint: in.Endpoint,
		Model: in.Model, KeyChange: parseKeyChange(in.KeyChange), Key: in.Key,
	})
	if err != nil {
		return dispatcher.Settings{}, settingsErr(err)
	}
	return toDispatcherSettings(&s), nil
}

func (settingsOps) AIPresets() []dispatcher.AIPreset {
	presets := inference.All()
	out := make([]dispatcher.AIPreset, 0, len(presets))
	for i := range presets {
		out = append(out, dispatcher.AIPreset{
			Name: presets[i].Name, Label: presets[i].Label,
			BaseURL: presets[i].BaseURL, KeyPrefix: presets[i].KeyPrefix,
		})
	}
	return out
}

// parseKeyChange —— 三态字符串 → 域的枚举。认不出的一律当 keep:
// 少一个字段不该变成"把 key 清了"。
func parseKeyChange(s string) owner.KeyChange {
	switch s {
	case "set":
		return owner.KeySet
	case "clear":
		return owner.KeyClear
	default:
		return owner.KeyKeep
	}
}

func toDispatcherSettings(s *owner.Settings) dispatcher.Settings {
	return dispatcher.Settings{
		AI: dispatcher.AISettings{
			Provider: s.AI.Provider, Endpoint: s.AI.Endpoint,
			Model: s.AI.Model, KeyConfigured: s.AI.KeyConfigured,
		},
		BYOAI: dispatcher.BYOAISettings{
			Enabled: s.BYOAI.Enabled, Providers: s.BYOAI.Providers,
			PublicBlurb: s.BYOAI.PublicBlurb,
		},
	}
}

func settingsErr(err error) error {
	// owner 不存在 = 这个会话指向的身份没了 → 401(前端据此跳登录),不是 404。
	if errors.Is(err, owner.ErrOwnerNotFound) {
		//nolint:wrapcheck // 类别错误原样上抛
		return dispatcher.Unauthed("owner not found")
	}
	if errors.Is(err, apierr.ErrEmptyField) {
		//nolint:wrapcheck // 同上
		return dispatcher.BadInput(err.Error())
	}
	return fmt.Errorf("settings op: %w", err)
}
