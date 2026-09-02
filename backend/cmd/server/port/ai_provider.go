// ai_provider.go — composition root adapts the inference preset table into owner's
// narrow ProviderValidator port (owner doesn't reverse-depend on inference, avoiding
// an inference→owner cycle).

package port

import (
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// InferenceProviders — owner.ProviderValidator implementation: is the provider
// name a known preset.
type InferenceProviders struct{}

// Known — a provider name is valid if it's in the inference preset table.
func (InferenceProviders) Known(provider string) bool {
	_, ok := inference.Lookup(provider)
	return ok
}

// AiPresets — the other half of the same table: owner needs to list this when it
// declares ai_provider.presets. Also carried through the composition root, same
// reason as above (owner can't import inference).
func AiPresets() []owner.AIPreset {
	presets := inference.All()
	out := make([]owner.AIPreset, 0, len(presets))
	for i := range presets {
		out = append(out, owner.AIPreset{
			Name: presets[i].Name, Label: presets[i].Label,
			BaseURL: presets[i].BaseURL, KeyPrefix: presets[i].KeyPrefix,
		})
	}
	return out
}
