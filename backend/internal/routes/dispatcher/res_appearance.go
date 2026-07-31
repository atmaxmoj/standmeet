// res_appearance.go —— 资源 appearance:owner 给自己公开语料页写的自定义 CSS
// (像 Obsidian 的 CSS snippet)。
//
// 写入时会 sanitize + scope 到内容区再落库,读回来的就是那个安全版本 —— 不是原样回显。
// 这一条是域的规矩,三个入口(admin UI / MCP / vault 同步)写的是同一处,所以也只有一份实现。
//
// op 的 id 就是 MCP 工具名,保持历史名字(set_owner_css / appearance.get_css 这种不一致
// 也保持:改名等于改 owner 客户端已经在用的接口)。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// AppearanceStore —— appearance 这组操作所需的最小口。
type AppearanceStore interface {
	GetCSS(ctx context.Context, ownerID string) (string, error)
	SetCSS(ctx context.Context, ownerID, css string) error
}

// Appearance —— appearance 资源:读 / 写自定义 CSS。
func Appearance(store AppearanceStore) Resource {
	return Resource{Name: "appearance", Ops: []Op{
		{
			ID: "appearance.get_css",
			Description: "Return the owner's current custom CSS (the sanitized + scoped " +
				"version stored on save).",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      appearanceGetCSS(store),
		},
		{
			ID: "set_owner_css",
			Description: "Set the owner's custom CSS for their public corpus pages (like an " +
				"Obsidian CSS snippet). Sanitized + scoped to the content area on save.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"css":{"type":"string","description":"Raw CSS"}},
				"required":["css"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: appearanceSetCSS(store),
		},
	}}
}

type cssOut struct {
	CSS string `json:"css"`
}

func appearanceGetCSS(store AppearanceStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		css, err := store.GetCSS(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("read css: %w", err)
		}
		return marshalOut(cssOut{CSS: css})
	}
}

type cssArgs struct {
	CSS string `json:"css"`
}

func appearanceSetCSS(store AppearanceStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in cssArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if err := store.SetCSS(ctx, ownerID, in.CSS); err != nil {
			return nil, fmt.Errorf("save css: %w", err)
		}
		// 回存好的那份(sanitize + scope 之后的),而不是回显入参 ——
		// 调用方看到的就是真正生效的东西。
		css, rerr := store.GetCSS(ctx, ownerID)
		if rerr != nil {
			return nil, fmt.Errorf("read back css: %w", rerr)
		}
		return marshalOut(cssOut{CSS: css})
	}
}
