// codes_slug_write.go — codes.set_slug: the owner renames a code's landing path (/c/<slug>).

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func setSlugOp(d *CodesDeps) fp.Op {
	return fp.Op{
		ID: "codes.set_slug", Danger: fp.DangerAuthority,
		Description: "Rename a code's landing path: a visitor who redeems the code lands on " +
			"/c/<slug>. The code string, its grant and its live sessions are unchanged.",
		InputSchema: codeSlugSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      setCodeSlug(d.Codes, extrasOr(d.Extras)),
	}
}

var codeSlugSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"slug":{"type":"string","description":"The new path: lowercase letters, digits, - and _."}
	},
	"required":["code_id","slug"]
}`)

func setCodeSlug(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codePageArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if perr := fp.RequireArgs([2]string{"code_id", in.CodeID}); perr != nil {
			return nil, perr
		}
		code, err := usecase.SetCodeSlug(ctx, deps, ownerID, in.CodeID, in.Slug)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}
