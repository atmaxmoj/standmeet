// provider_models.go — "what models does this provider have available" asks about the
// one the owner has **already configured**.
//
// Why this is needed (F-R-11): the `LOAD MODELS` button in the panel had always been
// hitting the visitor's no-auth path (`/api/v1/inference/models`), which requires the
// caller to **send the key along with the request** — a visitor genuinely holds their
// own key. The owner does not: his key is stored in the DB and the page can never read
// it back (which is correct). So after saving, clicking this button sent an empty key
// from the client, the backend replied 400 `key required`, and nothing showed on
// screen — even though that key genuinely exists and every visitor turn is using it.
//
// Lister is a **port, not a repository**: the key is ciphertext in the DB, and this
// side never unseals it (same rule as MCPServerProber). The implementation lives in the
// composition root, where both the unsealer (`unseal.go`'s openAIProviderKey) and the
// stateless list-fetching code (`infra/providermodels`) live.
//
// When no implementation is wired up (nil), say clearly that this instance lacks the
// capability, rather than pretending to have asked.

package usecase

import (
	"context"
	"errors"
	"fmt"
)

// ProviderModelLister — asks the owner's already-configured provider: what models do
// you have.
type ProviderModelLister interface {
	ListModels(ctx context.Context, ownerID, providerID string) ([]string, error)
}

// ErrNoModelLister — this instance has no model probe wired up.
var ErrNoModelLister = errors.New("this instance cannot list models")

// ListProviderModels — the call site for the port. An empty providerID = the default one.
func ListProviderModels(
	ctx context.Context, lister ProviderModelLister, ownerID, providerID string,
) ([]string, error) {
	if lister == nil {
		return nil, ErrNoModelLister
	}
	models, err := lister.ListModels(ctx, ownerID, providerID)
	if err != nil {
		return nil, fmt.Errorf("list provider models: %w", err)
	}
	return models, nil
}
