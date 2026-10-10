// application_events.go —— what an application commit records, on the commit's transaction.

package jobsuc

import (
	"context"

	"github.com/jackc/pgx/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// Application event types. Thin: subject application/<id>.
const (
	// ApplicationCommitted —— committed with its code: {application_id, code_id}.
	ApplicationCommitted = "application.committed"
	// ApplicationEngaged —— the recruiter's first conversation on the code, once per application:
	// {application_id, code_id, conversation_id}.
	ApplicationEngaged = "application.engaged"
	// ApplicationOutcomeChanged —— the owner set a new outcome: {application_id, from, to, note}.
	ApplicationOutcomeChanged = "application.outcome_changed"
)

// ApplicationEventTypes —— the application lifecycle's events, beside application.committed.
func ApplicationEventTypes() []events.Type {
	t := func(typ, desc string, filterable ...string) events.Type {
		return events.Type{
			Type: typ, Description: desc, Subject: "application/<application id>",
			Exposure: events.Webhook, Filterable: filterable,
		}
	}
	return []events.Type{
		t(ApplicationEngaged, "The recruiter talked on an application's code for the first time "+
			"(data.application_id, data.code_id, data.conversation_id).", "code_id"),
		t(ApplicationOutcomeChanged, "The owner set an application's outcome "+
			"(data.application_id, data.from, data.to, data.note)."),
	}
}

// commitWrites —— what a commit writes beside the application, on its transaction: the events, and
// the posting's ledger row marked applied (roadmap 8.4.b).
func commitWrites(
	rec events.Recorder, ownerID string, reuse *access.Code, job *jobsmodel.FetchedJob,
) func(context.Context, pgx.Tx, *CommitOutput) error {
	recordEvents := commitEvents(rec, ownerID, reuse)
	return func(ctx context.Context, tx pgx.Tx, out *CommitOutput) error {
		if err := recordEvents(ctx, tx, out); err != nil {
			return err
		}
		return markApplied(ctx, db.New(tx), ownerID, job, out.Application.ID)
	}
}

// commitEvents —— what a commit records on its transaction: code.issued when it issued a fresh
// code (not when it reused one), then application.committed.
func commitEvents(rec events.Recorder, ownerID string, reuse *access.Code) func(
	context.Context, pgx.Tx, *CommitOutput,
) error {
	return func(ctx context.Context, tx pgx.Tx, out *CommitOutput) error {
		r, codeID := rec.With(tx), out.AccessCode.ID
		if reuse == nil {
			err := access.RecordCodeEvent(ctx, r, access.CodeIssued, ownerID, codeID)
			if err != nil {
				return err
			}
		}
		appID := out.Application.ID
		data := map[string]string{"application_id": appID, "code_id": codeID}
		return r.Record(ctx, ownerID, ApplicationCommitted, "application/"+appID, data)
	}
}
