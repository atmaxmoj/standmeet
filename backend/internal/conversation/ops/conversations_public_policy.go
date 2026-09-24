// conversations_public_policy.go —— conversations.public_policy_get / _set: how the owner keeps
// codeless (public / byoai) conversations — saved or not, and a scheduled prune of idle ones.

package ops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func publicPolicyOps(chats *repo.ChatRepo) []fp.Op {
	return []fp.Op{
		{
			ID: "conversations.public_policy_get",
			Description: "Read how codeless (public/byoai) conversations are kept: save " +
				"(false = never stored), prune_cron ('' = off), retention_days, last_run_at.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getPublicPolicy(chats),
		},
		{
			ID: "conversations.public_policy_set",
			Description: "Set how codeless (public/byoai) conversations are kept: save=false " +
				"stops storing them; prune_cron deletes those idle > retention_days. " +
				"Coded conversations are never affected.",
			InputSchema: publicPolicySchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setPublicPolicy(chats),
		},
	}
}

var publicPolicySchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"save":{"type":"boolean","description":"false = codeless turns are never stored."},
		"prune_cron":{"type":"string",
			"description":"5-field cron or @daily/@hourly/@weekly (UTC); '' = no prune."},
		"retention_days":{"type":"number",
			"description":"Prune conversations idle longer than this many days (>= 1)."}
	},
	"required":["save","prune_cron","retention_days"]
}`)

type publicPolicyJSON struct {
	LastRunAt     time.Time `json:"last_run_at"`
	PruneCron     string    `json:"prune_cron"`
	RetentionDays int32     `json:"retention_days"`
	Save          bool      `json:"save"`
}

func publicPolicyOut(p *repo.PublicPolicy) (json.RawMessage, error) {
	return json.Marshal(publicPolicyJSON{
		Save: p.Save, PruneCron: p.PruneCron, RetentionDays: p.RetentionDays,
		LastRunAt: p.LastRunAt,
	})
}

func getPublicPolicy(chats *repo.ChatRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		p, err := chats.GetPublicPolicy(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("conversations.public_policy_get", err)
		}
		return publicPolicyOut(&p)
	}
}

func setPublicPolicy(chats *repo.ChatRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in publicPolicyJSON
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		want := repo.PublicPolicy{
			Save: in.Save, PruneCron: in.PruneCron, RetentionDays: in.RetentionDays,
		}
		if verr := repo.ValidatePublicPolicy(&want); verr != nil {
			return nil, fp.BadInput(verr.Error())
		}
		p, err := chats.SetPublicPolicy(ctx, ownerID, &want)
		if err != nil {
			return nil, fp.OpErr("conversations.public_policy_set", err)
		}
		return publicPolicyOut(&p)
	}
}
