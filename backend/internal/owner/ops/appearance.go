// appearance.go —— custom CSS the owner writes for their own public corpus pages (like an
// Obsidian CSS snippet).
//
// A write sanitizes + scopes it to the content area before storing, and a read returns that
// safe version — never an unmodified echo. This rule belongs to the domain, and all three
// entry points (panel / MCP / vault sync) share the one implementation.
//
// The op's id is the MCP tool name; the historical name is kept (and the mismatch between
// `set_owner_css` and `appearance.get_css` is kept too: renaming means changing an interface
// owner clients already use).

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Appearance —— read / write custom CSS.
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

// setCSS —— reads back after storing: the caller sees the version that **actually takes
// effect** (post sanitize + scope), not the raw text it sent.
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
