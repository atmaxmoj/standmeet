// appearance.go —— owner 给自己公开语料页写的自定义 CSS(像 Obsidian 的 CSS snippet)。
//
// 写入会 sanitize + scope 到内容区再落库,读回来的就是那个安全版本 —— 不是原样回显。
// 这条规矩属于域,三个入口(面板 / MCP / vault 同步)共用同一份实现。
//
// op 的 id 就是 MCP 工具名,保持历史名字(`set_owner_css` 和 `appearance.get_css` 不一致
// 也保持:改名等于改 owner 客户端已经在用的接口)。

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Appearance —— 读 / 写自定义 CSS。
func Appearance(store usecase.CSSStore) []fp.Op {
	return []fp.Op{
		{
			ID: "appearance.get_css",
			Description: "Return the owner's current custom CSS — the sanitized, scoped " +
				"version that was stored on save.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getCSS(store),
		},
		{
			ID: "set_owner_css",
			Description: "Set the owner's custom CSS for their public corpus pages, like an " +
				"Obsidian CSS snippet. Sanitized and scoped to the content area on save.",
			InputSchema: cssSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCSS(store),
		},
	}
}

var cssSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"css":{"type":"string","description":"Raw CSS."}},
	"required":["css"]
}`)

type cssPayload struct {
	CSS string `json:"css"`
}

func getCSS(store usecase.CSSStore) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		return readCSS(ctx, store, ownerID)
	}
}

// setCSS —— 存完回读:调用方看到的是**真正生效**的那份(sanitize + scope 之后),
// 不是它自己发来的原文。
func setCSS(store usecase.CSSStore) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in cssPayload
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := usecase.SetOwnerCSS(ctx, store, ownerID, in.CSS); err != nil {
			return nil, fp.OpErr("save owner css", err)
		}
		return readCSS(ctx, store, ownerID)
	}
}

func readCSS(
	ctx context.Context, store usecase.CSSStore, ownerID string,
) (json.RawMessage, error) {
	css, err := store.GetCSS(ctx, ownerID)
	if err != nil {
		return nil, fp.OpErr("read owner css", err)
	}
	return json.Marshal(cssPayload{CSS: css})
}
