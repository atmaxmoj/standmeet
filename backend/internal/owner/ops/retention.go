// retention.go —— the owner's hands on an ephemeral bundle (docs/design/job-loop-retention.md):
// pin it, or restore it after it was cleared. Members join a bundle where they are created
// (jobs.annotate, microsite.create).

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const retentionReach = "an owner-AI lifecycle action; the panel shows the clock on the rows"

var (
	retentionPinSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"bundle_id":{"type":"string"},
			"keep":{"type":"boolean","description":"true stops the clock; false restarts 90 days"}
		},
		"required":["bundle_id","keep"]
	}`)
	retentionBundleSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"bundle_id":{"type":"string"}},
		"required":["bundle_id"]
	}`)
)

type retentionArgs struct {
	Keep     *bool  `json:"keep"`
	BundleID string `json:"bundle_id"`
}

type pinOut struct {
	BundleID string `json:"bundle_id"`
	Keep     bool   `json:"keep"`
}

type restoreOut struct {
	BundleID string `json:"bundle_id"`
	Restored bool   `json:"restored"`
}

// RetentionOps —— retention.pin, retention.restore. None without the clock wired.
func RetentionOps(d *usecase.RetentionDeps) []fp.Op {
	if d == nil {
		return []fp.Op{}
	}
	return []fp.Op{{
		ID: "retention.pin", Danger: fp.DangerWrite, Kind: fp.Action,
		Reach: fp.Only(retentionReach, "mcp"), InputSchema: retentionPinSchema,
		Description: "Pin an ephemeral bundle (keep: true) so it never expires, or unpin it " +
			"(keep: false), which starts a fresh 90 days. The bundle is the shared clock of an " +
			"assessment, its microsite and the code bound to it.",
		Invoke: pinInvoke(d),
	}, {
		ID: "retention.restore", Danger: fp.DangerWrite, Kind: fp.Action,
		Reach: fp.Only(retentionReach, "mcp"), InputSchema: retentionBundleSchema,
		Description: "Bring back a bundle the retention sweep cleared, on a fresh 90 days: its " +
			"assessments and its microsites return. Its revoked codes stay revoked — issue a new " +
			"one. Possible for 90 days after the clearing.",
		Invoke: restoreInvoke(d),
	}}
}

func pinInvoke(d *usecase.RetentionDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in retentionArgs
		if err := json.Unmarshal(raw, &in); err != nil || in.Keep == nil || in.BundleID == "" {
			return nil, fp.BadInput("bundle_id and keep are required")
		}
		if err := usecase.PinRetention(ctx, d, ownerID, in.BundleID, *in.Keep); err != nil {
			return nil, retentionErr(err)
		}
		return json.Marshal(pinOut{BundleID: in.BundleID, Keep: *in.Keep})
	}
}

func restoreInvoke(d *usecase.RetentionDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in retentionArgs
		if err := json.Unmarshal(raw, &in); err != nil || in.BundleID == "" {
			return nil, fp.BadInput("bundle_id is required")
		}
		if err := usecase.RestoreRetention(ctx, d, ownerID, in.BundleID); err != nil {
			return nil, retentionErr(err)
		}
		return json.Marshal(restoreOut{BundleID: in.BundleID, Restored: true})
	}
}

func retentionErr(err error) error {
	for _, e := range []error{
		usecase.ErrBadRetention, usecase.ErrRetentionNotFound, usecase.ErrRetentionNotCleared,
		repo.ErrRetentionSlugTaken,
	} {
		if errors.Is(err, e) {
			return fp.BadInput(e.Error())
		}
	}
	return fp.OpErr("retention", err)
}
