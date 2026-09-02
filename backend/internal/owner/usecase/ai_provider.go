// ai_provider.go — the usecase for an owner switching / configuring their own AI provider.
//
// Validates that the provider is legit + talks to repo; the plaintext key never gets
// written to a log, only passed through to repo where it's encrypted via AES-GCM.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// AIProviderDeps — dependencies for UpdateOwnerAIProvider.
type AIProviderDeps struct {
	Owners    *repo.Repo
	Providers ProviderValidator
}

// ProviderValidator — the narrow port that validates whether a provider name is a known
// preset. owner does not depend back on inference (inference→owner would form a cycle);
// the composition root adapts inference.Lookup in through this interface.
type ProviderValidator interface {
	Known(provider string) bool
}

// UpdateOwnerAIProviderInput — input.
//   - Provider:  any Name from the preset table (anthropic / openai / deepseek / kimi /
//     groq / siliconflow / openrouter / together / custom), validated server-side.
//   - Endpoint:  base URL (without /v1/...). The frontend prefills it from the preset
//     when a provider is picked; custom requires the owner to fill it in. **Must be non-empty**.
//   - Model:     model id. Also prefilled from the preset by the frontend; the owner can
//     change it. **Must be non-empty**.
//   - KeyChange: KeyKeep (leave alone) / KeySet (set a new key) / KeyClear (delete the key)
//   - Key:       the plaintext key when KeyChange=KeySet; ignored otherwise
type UpdateOwnerAIProviderInput struct {
	OwnerID   string
	Provider  string
	Endpoint  string
	Model     string
	Key       string
	KeyChange KeyChange
}

// KeyChange — a three-state enum for "leave alone / set a new key / clear the key".
type KeyChange int

// KeyKeep / KeySet / KeyClear are the three values of KeyChange.
const (
	KeyKeep KeyChange = iota
	KeySet
	KeyClear
)

// UpdateOwnerAIProvider — calls repo to persist. Returns the new OwnerSettings (no
// plaintext key). Validation: provider must be in the inference preset table; endpoint +
// model must be non-empty (the preset supplies UI defaults, but the server never falls
// back to them — that would risk persisting a partial row).
func UpdateOwnerAIProvider(
	ctx context.Context, deps AIProviderDeps, in *UpdateOwnerAIProviderInput,
) (entity.Settings, error) {
	if verr := validateAIProviderInput(deps.Providers, in); verr != nil {
		return entity.Settings{}, verr
	}
	s, err := deps.Owners.UpdateAIProvider(ctx, &repo.UpdateAIProviderInput{
		OwnerID:      in.OwnerID,
		Provider:     in.Provider,
		Endpoint:     in.Endpoint,
		Model:        in.Model,
		KeyPlaintext: resolveKeyArg(in.KeyChange, in.Key),
	})
	if err != nil {
		return entity.Settings{}, fmt.Errorf("update ai provider: %w", err)
	}
	return s, nil
}

func validateAIProviderInput(providers ProviderValidator, in *UpdateOwnerAIProviderInput) error {
	if !providers.Known(in.Provider) {
		return fmt.Errorf("%w: unknown provider %q", apierr.ErrEmptyField, in.Provider)
	}
	if in.Endpoint == "" || in.Model == "" {
		return fmt.Errorf("%w: endpoint + model required", apierr.ErrEmptyField)
	}
	return nil
}

func resolveKeyArg(kc KeyChange, key string) *string {
	switch kc {
	case KeySet:
		k := key
		return &k
	case KeyClear:
		empty := ""
		return &empty
	case KeyKeep:
		return nil
	}
	return nil
}
