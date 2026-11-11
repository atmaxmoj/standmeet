// codes_model_write.go — codes.set_model: the owner pins the model a code's screen-assistant cue
// (and chat) runs on, over its resolved provider's own model (access_codes.model), or clears it.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func setModelOp(d *CodesDeps) fp.Op {
	return fp.Op{
		ID: "codes.set_model", Danger: fp.DangerAuthority,
		Description: "Pin the model this code's cue (and chat) runs on, over its provider's " +
			"own — e.g. sonnet for one code while the key's default stays haiku. Empty clears " +
			"it. The code, its grant and its live sessions are unchanged.",
		InputSchema: codeModelSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      setCodeModel(d.Codes, extrasOr(d.Extras)),
	}
}

var codeModelSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"model":{"type":"string","description":"Model id to pin; empty clears the override."}
	},
	"required":["code_id"]
}`)

type codeModelArgs struct {
	CodeID string `json:"code_id"`
	Model  string `json:"model"`
}

func setCodeModel(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeModelArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if perr := fp.RequireArgs([2]string{"code_id", in.CodeID}); perr != nil {
			return nil, perr
		}
		code, err := usecase.SetCodeModel(ctx, deps, ownerID, in.CodeID, in.Model)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}
