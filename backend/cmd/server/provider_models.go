// provider_models.go —— the owner asking their own already-configured provider: which
// models do you have (F-R-11)?
//
// Why the implementation lives at the composition root and not in the owner domain:
// that provider's key is ciphertext in the DB, and **the core only seals, never
// unseals** (see the note at the top of unseal.go). The domain declares a port
// (`ProviderModelLister`), and this file wires together two things that already exist:
//
//   - `openAIProviderKey` (unseal.go) — translates "the stored shape" into "the
//     directly usable shape";
//   - `infra/providermodels.List` — the stateless code that fetches the list; the
//     visitor-side BYOAI path uses this exact same one.
//
// So this isn't a newly built outbound path either: the owner's `LOAD MODELS` button
// now goes through "the server fetches its own stored key and asks", not "have the
// page submit something it can't even read".
//
// (There's a blank line between the block above and `package` because the package
// comment lives in exactly one place, doc.go.)

package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/providermodels"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// providerModelLister —— implementation of ProviderModelLister.
type providerModelLister struct {
	owners *owner.Repo
}

// ListModels —— reads the row, unseals the key, asks upstream. An empty providerID
// means the default one.
func (l *providerModelLister) ListModels(
	ctx context.Context, ownerID, providerID string,
) ([]string, error) {
	row, err := l.providerRow(ctx, ownerID, providerID)
	if err != nil {
		return nil, err
	}
	key, kerr := openAIProviderKey(ownerID, row.KeyEnc)
	if kerr != nil {
		return nil, fmt.Errorf("open provider key: %w", kerr)
	}
	models, lerr := providermodels.List(ctx, row.Provider, row.Endpoint, key)
	if lerr != nil {
		return nil, sayableListErr(lerr)
	}
	return models, nil
}

// sayableListErr —— translates "what went wrong on the provider's side" into the
// **category the convergence point understands**.
//
// Why the translation lives at the composition root: `providermodels` speaks HTTP
// (DisplayError carries its own status code + human-readable text); neither the
// domain nor the convergence point understands HTTP. Without this translation it
// would be treated as an unknown error the whole way through, and the owner would
// read **`internal error`** under the button — while the same failure on the visitor
// path reads "Couldn't reach the model provider — check the base URL and key."
// **Same failure, two faces, two messages — and one of them says nothing at all.**
// (Surfaced by the F-R-11 fix itself, hit head-on while driving check 3's third tile.)
func sayableListErr(err error) error {
	var de apierr.DisplayError
	if !errors.As(err, &de) {
		return fmt.Errorf("list provider models: %w", err)
	}
	return fp.Coded(fp.BadInput(de.DisplayMessage()), de.DisplayCode())
}

func (l *providerModelLister) providerRow(
	ctx context.Context, ownerID, providerID string,
) (owner.ProviderRow, error) {
	if providerID == "" {
		row, err := l.owners.DefaultProvider(ctx, ownerID)
		if err != nil {
			return owner.ProviderRow{}, fmt.Errorf("default provider: %w", err)
		}
		return row, nil
	}
	row, err := l.owners.GetProvider(ctx, ownerID, providerID)
	if err != nil {
		return owner.ProviderRow{}, fmt.Errorf("get provider: %w", err)
	}
	return row, nil
}
