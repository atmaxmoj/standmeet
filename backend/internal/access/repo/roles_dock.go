// roles_dock.go —— #109/#110 encodes/decodes role's dock_buttons jsonb column <->
// []DockButtonConfig. Split out of roles.go to respect max-lines (350).

package repo

import (
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

// marshalDockButtons —— []DockButtonConfig → a jsonb value (one bind parameter,
// no SQL string-building). nil/empty → "[]" (matches the column's DEFAULT, not NULL).
func marshalDockButtons(buttons []entity.DockButtonConfig) ([]byte, error) {
	if len(buttons) == 0 {
		return []byte("[]"), nil
	}
	b, err := json.Marshal(buttons)
	if err != nil {
		return nil, fmt.Errorf("marshal dock buttons: %w", err)
	}
	return b, nil
}

// decodeDockButtons —— a jsonb value → []DockButtonConfig (row → domain).
// Empty/malformed → an empty slice (never nil).
func decodeDockButtons(raw []byte) []entity.DockButtonConfig {
	out := []entity.DockButtonConfig{}
	if len(raw) == 0 {
		return out
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return []entity.DockButtonConfig{}
	}
	return out
}
