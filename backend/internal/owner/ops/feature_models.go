// feature_models.go —— owner ops that pin a MODEL per feature (owner_feature_models), overriding
// the resolved provider's own model while reusing its key — one key serves haiku for visitor chat
// and sonnet for the 'screen_assistant' (interview cue) feature, no duplicate provider. Resolution:
// code.model > role×feature > feature global > provider.model. These ride the providers.* op group
// (Providers appends featureModelOps), so both faces (mcp + admin) carry them.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// featureModelOps —— features.set_model / list_models / clear_model, added to the Providers group.
func featureModelOps(d ProvidersDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "features.set_model", Danger: fp.DangerSpend,
			Description: "Pin the MODEL a feature runs on, overriding the resolved " +
				"provider's own model while reusing its key — one key serves haiku for " +
				"visitor chat and sonnet for the 'screen_assistant' (interview cue) feature, " +
				"no duplicate provider. Omit role_id for the feature's instance-wide model; " +
				"pass a role id to override that feature for one role. Resolution: " +
				"code.model > role×feature > feature global > provider.model.",
			InputSchema: featureModelSetSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setFeatureModel(d),
		},
		{
			ID: "features.list_models",
			Description: "List the owner's feature→model pins (feature, role_id — '' is " +
				"the global pin, model).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listFeatureModels(d),
		},
		{
			ID: "features.clear_model", Danger: fp.DangerSpend,
			Description: "Remove a feature's model pin (back to the layer above it). Omit " +
				"role_id for the global pin; pass a role id to remove that role's override.",
			InputSchema: featureModelClearSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      clearFeatureModel(d),
		},
	}
}

var (
	featureModelSetSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"feature":{"type":"string","description":"Feature name, e.g. 'screen_assistant'."},
			"model":{"type":"string","description":"Model id, e.g. 'claude-sonnet-5-5'."},
			"role_id":{"type":"string","description":"Optional: override this feature for a role."}
		},
		"required":["feature","model"]
	}`)

	featureModelClearSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"feature":{"type":"string"},
			"role_id":{"type":"string","description":"Omit for the global pin; else a role id."}
		},
		"required":["feature"]
	}`)
)

// featureModelOut —— one feature→model pin. RoleID "" is the feature's instance-wide pin.
type featureModelOut struct {
	RoleID  string `json:"role_id"`
	Feature string `json:"feature"`
	Model   string `json:"model"`
}

func setFeatureModel(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Feature string `json:"feature"`
			Model   string `json:"model"`
			RoleID  string `json:"role_id"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs(
			[2]string{"feature", in.Feature}, [2]string{"model", in.Model},
		); err != nil {
			return nil, err
		}
		err := d.Providers.Owners.SetFeatureModel(ctx, ownerID, in.RoleID, in.Feature, in.Model)
		if err != nil {
			return nil, fp.OpErr("set feature model", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

func clearFeatureModel(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Feature string `json:"feature"`
			RoleID  string `json:"role_id"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"feature", in.Feature}); err != nil {
			return nil, err
		}
		err := d.Providers.Owners.ClearFeatureModel(ctx, ownerID, in.RoleID, in.Feature)
		if err != nil {
			return nil, fp.OpErr("clear feature model", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

func listFeatureModels(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := d.Providers.Owners.ListFeatureModels(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list feature models", err)
		}
		out := make([]featureModelOut, 0, len(rows))
		for i := range rows {
			out = append(out, featureModelOut{
				RoleID: rows[i].RoleID, Feature: rows[i].Feature, Model: rows[i].Model,
			})
		}
		return json.Marshal(out)
	}
}
