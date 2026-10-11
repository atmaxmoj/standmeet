// fiber_outcomes.go —— applications.update_outcome (roadmap 1.3.b): the owner's AI records what
// came of an application. The admin panel sets it through jobsadmin's /applications/{id}/outcome,
// which runs the same use case.

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

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
		Reach:       fp.Only("the panel sets it through jobsadmin's applications route", mcpFace),
		InputSchema: updateOutcomeSchema,
		Description: "Record what came of an application: responded, interview, offer, " +
			"rejected, hired, or withdrawn. Each change is added to the application's timeline. " +
			"Withdrawing also revokes its access code, and the result names the embeds and " +
			"microsites the code still opened (they stop working with it).",
		Invoke: updateOutcomeInvoke(d, log),
	}, {
		ID: "applications.engagement", Kind: fp.Read,
		Reach:       fp.Only("the panel reads it in the application detail", mcpFace),
		InputSchema: appIDSchema,
		Description: "What the recruiter asked on an application's code and what the agent " +
			"answered: each question with grounded (the answer stood on the corpus) and topics " +
			"(pay, start, availability, authorization — quoted verbatim in answer). " +
			"An ungrounded " +
			"answer is a gap: write the note that would have answered it.",
		Invoke: engagementInvoke(d, log),
	}, {
		ID: "applications.export", Kind: fp.Read,
		Reach:       fp.Only("an owner-AI vault write: the agent saves the file", mcpFace),
		InputSchema: appIDSchema,
		Description: "An application as a markdown file for the owner's vault: its timeline " +
			"and the recruiter's questions, gaps marked. Save markdown at path under the vault " +
			"root. One way: nothing reads the file back.",
		Invoke: exportInvoke(d, log),
	}, {
		ID: "applications.gaps", Kind: fp.Read,
		Reach:       fp.Only("an owner-AI planning read", mcpFace),
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Description: "Every question the corpus could not answer, across all applications, " +
			"counted: what to write next.",
		Invoke: gapsInvoke(d, log),
	}, {
		ID: "applications.followups_due", Kind: fp.Read,
		Reach:       fp.Only("the panel shows follow-up due on the row", mcpFace),
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Description: "Applications due a follow-up now: no answer a week after commit (two " +
			"nudges at most, then cold), a thank-you a day after an interview, a check-in after " +
			"30 silent days. An application someone opened is never nudged blind: answer what " +
			"they asked (applications.engagement).",
		Invoke: followupsInvoke(d, log),
	}, {
		ID: "applications.funnel", Kind: fp.Read,
		Reach:       fp.Only("an owner-AI planning read", mcpFace),
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Description: "How many applications ever reached each stage (a rejection after an " +
			"interview still counts the interview), and median days to open and to a first " +
			"outcome — shown only from 20 samples. Applications still waiting are counted as " +
			"excluded_waiting.",
		Invoke: funnelInvoke(d, log),
	}}
}

// dueView —— one application due a follow-up.
type dueView struct {
	OpenedAt      *time.Time `json:"opened_at"`
	DueSince      *time.Time `json:"due_since"`
	ApplicationID string     `json:"application_id"`
	Company       string     `json:"company"`
	Role          string     `json:"role"`
	Outcome       string     `json:"outcome"`
	Nudges        int        `json:"nudges"`
}

func followupsInvoke(d *jobsuc.OutcomeDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		apps, err := d.Apps.DueFollowups(ctx, ownerID)
		if err != nil {
			return nil, outcomeErr(log, err)
		}
		out := make([]dueView, 0, len(apps))
		for i := range apps {
			a := &apps[i]
			out = append(out, dueView{
				ApplicationID: a.ID, Company: a.JobSnapshot.Company, Role: a.JobSnapshot.Title,
				Outcome: a.Outcome, Nudges: a.FollowupNudges, DueSince: a.NextFollowupAt,
				OpenedAt: a.OpenedAt,
			})
		}
		return marshalRead(map[string][]dueView{"due": out})
	}
}

func funnelInvoke(d *jobsuc.OutcomeDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		f, err := jobsuc.FunnelOf(ctx, d.Apps, ownerID)
		if err != nil {
			return nil, outcomeErr(log, err)
		}
		return marshalRead(f)
	}
}

var appIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"application_id":{"type":"string"}},
	"required":["application_id"]
}`)

func exportInvoke(d *jobsuc.OutcomeDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			ApplicationID string `json:"application_id"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		f, err := jobsuc.ExportApplication(ctx, d.Apps, ownerID, args.ApplicationID)
		if err != nil {
			return nil, outcomeErr(log, err)
		}
		return marshalRead(f)
	}
}

func engagementInvoke(d *jobsuc.OutcomeDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			ApplicationID string `json:"application_id"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		e, err := jobsuc.EngagementOf(ctx, d.Apps, ownerID, args.ApplicationID)
		if err != nil {
			return nil, outcomeErr(log, err)
		}
		return marshalRead(e)
	}
}

func gapsInvoke(d *jobsuc.OutcomeDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		gaps, err := jobsuc.GapsAcross(ctx, d.Apps, ownerID)
		if err != nil {
			return nil, outcomeErr(log, err)
		}
		return marshalRead(map[string][]jobsmodel.Gap{"gaps": gaps})
	}
}

// mcpFace —— the one face these ops are reached through.
const mcpFace = "mcp"

type readResult interface {
	jobsmodel.Engagement | map[string][]jobsmodel.Gap | map[string][]dueView |
		jobsmodel.Funnel | jobsmodel.ExportFile
}

func marshalRead[T readResult](v T) (json.RawMessage, error) {
	out, err := json.Marshal(v)
	if err != nil {
		return nil, errors.New("encode result: " + err.Error())
	}
	return out, nil
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
