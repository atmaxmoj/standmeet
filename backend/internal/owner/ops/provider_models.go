// provider_models.go —— `providers.list_models`: asks which models an owner's **already
// configured** provider offers.
//
// Why a separate op instead of reusing the visitor one (F-R-11): the visitor op
// (`/api/v1/inference/models`) has no auth, so it requires the caller to send the key along
// with the request — a visitor genuinely holds their own key. The owner doesn't: their key
// is stored in the database and the page can never read it back. The panel button used to
// hit the visitor path, sending an empty key, getting a 400, with nothing shown on screen.
//
// The outbound reply has no key and no endpoint — only model names. What the owner wants is
// "which ones can I pick".

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

var providerModelsSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"id":{"type":"string","description":"Provider id; omit for the default one."}
	}
}`)

type providerModelsArgs struct {
	ID string `json:"id"`
}

type providerModelsOut struct {
	Models []string `json:"models"`
}

func listProviderModels(lister usecase.ProviderModelLister) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, derr := decodeProviderModelsArgs(raw)
		if derr != nil {
			return nil, derr
		}
		models, err := usecase.ListProviderModels(ctx, lister, ownerID, args.ID)
		if err != nil {
			return nil, alreadySaidOr(err, "list provider models")
		}
		return json.Marshal(providerModelsOut{Models: models})
	}
}

// alreadySaidOr —— when the port side has already said it clearly, **pass it through
// unchanged**; only fall back to this layer's own wording when it hasn't.
//
// Why this is needed: a failure on the provider side carries a message already translated
// for the owner to read (done by the assembly root), while every layer along the way tends
// to prefix its own text out of habit. The first version did exactly that, and the screen
// showed `list provider models: list provider models: Couldn't reach the model provider…` —
// of the three segments, only the last was meant for a human to read (spotted while driving
// check 3's third cell).
func alreadySaidOr(err error, what string) error {
	if fp.IsBadInput(err) {
		return unwrapToClassified(err)
	}
	return providerErr(what, err)
}

// unwrapToClassified —— peels down to the layer whose error "speaks for itself", leaving
// the prefixes added on the way in the logs.
func unwrapToClassified(err error) error {
	for {
		inner := errors.Unwrap(err)
		if inner == nil || !fp.IsBadInput(inner) {
			return err
		}
		err = inner
	}
}

// decodeProviderModelsArgs —— every arg is optional: an empty body is valid too (the panel
// button's question is exactly "the default one").
func decodeProviderModelsArgs(raw json.RawMessage) (providerModelsArgs, error) {
	var args providerModelsArgs
	if len(raw) == 0 {
		return args, nil
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	return args, nil
}
