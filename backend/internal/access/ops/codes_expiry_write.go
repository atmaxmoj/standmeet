// codes_expiry_write.go — codes.set_expiry: the owner moves or clears a code's expiry.

package ops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func setExpiryOp(d *CodesDeps) fp.Op {
	return fp.Op{
		ID: "codes.set_expiry", Danger: fp.DangerAuthority,
		Description: "Move or clear a code's expiry (null = never). A code past its expiry is " +
			"refused at the door and its live sessions end. A code bound to an ephemeral page " +
			"follows the page's clock instead (expiry_follows_page).",
		InputSchema: codeExpirySchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      setCodeExpiry(d.Codes, extrasOr(d.Extras)),
	}
}

var codeExpirySchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"expires_at":{"type":["string","null"],"description":"RFC3339; null = never."}
	},
	"required":["code_id","expires_at"]
}`)

type codeExpiryArgs struct {
	ExpiresAt *string `json:"expires_at"`
	CodeID    string  `json:"code_id"`
}

func setCodeExpiry(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		ch, perr := decodeExpiry(raw)
		if perr != nil {
			return nil, perr
		}
		code, err := usecase.SetCodeExpiry(ctx, deps, ownerID, ch.codeID, ch.at)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}

// expiryChange —— the code and its new expiry (nil = never).
type expiryChange struct {
	at     *time.Time
	codeID string
}

func decodeExpiry(raw json.RawMessage) (expiryChange, error) {
	var in codeExpiryArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return expiryChange{}, fp.BadInput("invalid arguments: " + err.Error())
	}
	if perr := fp.RequireArgs([2]string{"code_id", in.CodeID}); perr != nil {
		return expiryChange{}, perr
	}
	at, perr := parseOptionalRFC3339(derefString(in.ExpiresAt))
	return expiryChange{codeID: in.CodeID, at: at}, perr
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
