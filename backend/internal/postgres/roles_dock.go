// roles_dock.go —— #109/#110 role 的 dock_buttons jsonb 列 <-> []DockButtonConfig 编解码。
// 从 roles.go 拆出守 max-lines(350)。

package postgres

import (
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access"
)

// marshalDockButtons —— []DockButtonConfig → jsonb 值（一个 bind 参数，不拼 SQL）。
// nil/空 → "[]"（跟列的 DEFAULT 对齐，非 NULL）。
func marshalDockButtons(buttons []access.DockButtonConfig) ([]byte, error) {
	if len(buttons) == 0 {
		return []byte("[]"), nil
	}
	b, err := json.Marshal(buttons)
	if err != nil {
		return nil, fmt.Errorf("marshal dock buttons: %w", err)
	}
	return b, nil
}

// decodeDockButtons —— jsonb 值 → []DockButtonConfig（row → domain）。空/坏 → 空切片（非 nil）。
func decodeDockButtons(raw []byte) []access.DockButtonConfig {
	out := []access.DockButtonConfig{}
	if len(raw) == 0 {
		return out
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return []access.DockButtonConfig{}
	}
	return out
}
