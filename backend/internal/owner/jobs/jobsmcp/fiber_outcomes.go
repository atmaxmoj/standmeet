// fiber_outcomes.go —— applications.update_outcome (roadmap 1.3.b): the owner's AI records what
// came of an application. The admin panel sets it through jobsadmin's /applications/{id}/outcome,
// which runs the same use case.

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

var updateOutcomeSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"application_id":{"type":"string","description":"the application's id"},
		"outcome":{"type":"string",
			"enum":["none","responded","interview","offer","rejected","hired","withdrawn"],
			"description":"what came of it. withdrawn also revokes the application's code."},
		"note":{"type":"string","description":"optional: what happened, in the owner's words"}
	},
	"required":["application_id","outcome"]
}`)

// OutcomeOps —— applications.update_outcome.
func OutcomeOps(d *jobsuc.OutcomeDeps, log *slog.Logger) []fp.Op {
	return []fp.Op{{
		ID: "applications.update_outcome", Kind: fp.Action, Danger: fp.DangerWrite,
		Reach:       fp.Only("the panel sets it through jobsadmin's applications route", "mcp"),
		InputSchema: updateOutcomeSchema,
		Description: "Record what came of an application: responded, interview, offer, " +
			"rejected, hired, or withdrawn. Each change is added to the application's timeline. " +
			"Withdrawing also revokes its access code, and the result names the embeds and " +
			"microsites the code still opened (they stop working with it).",
		Invoke: updateOutcomeInvoke(d, log),
	}}
}

// outcomeResult —— the application's row, and what a withdrawal cuts off.
type outcomeResult struct {
	*jobsmodel.ApplicationRow

	Bound *jobsuc.Bound `json:"bound,omitempty"`
}

func updateOutcomeInvoke(d *jobsuc.OutcomeDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			ApplicationID string `json:"application_id"`
			Outcome       string `json:"outcome"`
			Note          string `json:"note"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		res, err := jobsuc.UpdateOutcome(ctx, d, &jobsuc.OutcomeChange{
			OwnerID: ownerID, ApplicationID: args.ApplicationID, To: args.Outcome, Note: args.Note,
		})
		if err != nil {
			return nil, outcomeErr(log, err)
		}
		row := jobsmodel.RowOf(&res.Application)
		out, err := json.Marshal(outcomeResult{ApplicationRow: &row, Bound: res.Bound})
		if err != nil {
			return nil, errors.New("encode result: " + err.Error())
		}
		return out, nil
	}
}

func outcomeErr(log *slog.Logger, err error) error {
	switch {
	case errors.Is(err, jobsmodel.ErrApplicationNotFound):
		return errors.New("application not found")
	case errors.Is(err, jobsmodel.ErrUnknownOutcome):
		return errors.New("outcome must be one of: none, responded, interview, offer, rejected, " +
			"hired, withdrawn")
	}
	log.Error("applications.update_outcome", "err", err)
	return errors.New("applications.update_outcome failed")
}
