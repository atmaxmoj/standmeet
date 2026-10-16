// instance_models.go —— instance.models: which provider and model each feature runs on, and why.
// The resolution order is the session's (visitor_deps.go resolveSessionProviderID): byoai > code >
// role > default. Plugins' host generation always runs on the default.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/stats/entity"
	"github.com/atmaxmoj/standmeet/internal/stats/repo"
)

type providerOut struct {
	Label string `json:"label"`
	Model string `json:"model"`
}

type featureModelOut struct {
	Codes         *int64 `json:"codes,omitempty"`
	Feature       string `json:"feature"`
	Via           string `json:"via"`
	ProviderLabel string `json:"provider_label"`
	Model         string `json:"model"`
}

type modelsOut struct {
	Default  providerOut       `json:"default"`
	Features []featureModelOut `json:"features"`
}

func modelsOp(usage *repo.InferenceUsageRepo) fp.Op {
	return fp.Op{
		ID: "instance.models",
		Description: "Which provider and model each feature runs on, and why: the default " +
			"provider; per role 'chat:<role>' (via role = it names a provider, via default = " +
			"it falls to the default; codes = live codes on it); 'code:<code>' for a code that " +
			"names its own provider (a code outranks its role); 'blocks' (plugins run on the " +
			"default); 'byoai' (the visitor's own key).",
		InputSchema: noArgs,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      instanceModels(usage),
	}
}

func instanceModels(usage *repo.InferenceUsageRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		m, err := usage.ModelMap(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("model map", err)
		}
		return json.Marshal(modelsOut{
			Default:  providerOut{Label: m.Default.Label, Model: m.Default.Model},
			Features: features(&m),
		})
	}
}

func features(m *entity.ModelMap) []featureModelOut {
	out := make([]featureModelOut, 0, len(m.Roles)+len(m.Codes)+2)
	for i := range m.Roles {
		codes := m.Roles[i].Codes
		f := onProvider("chat:"+m.Roles[i].Name, "role", m.Roles[i].Provider, m.Default)
		f.Codes = &codes
		out = append(out, f)
	}
	for i := range m.Codes {
		c := &m.Codes[i]
		out = append(out, onProvider("code:"+c.Code, "code", c.Provider, m.Default))
	}
	return append(out,
		onProvider("blocks", "default", m.Default, m.Default),
		featureModelOut{Feature: "byoai", Via: "visitor"})
}

// onProvider —— a feature on its own provider, or on the default when it names none.
func onProvider(feature, via string, own, dflt entity.ProviderModel) featureModelOut {
	if own.Label == "" {
		via, own = "default", dflt
	}
	return featureModelOut{Feature: feature, Via: via, ProviderLabel: own.Label, Model: own.Model}
}
