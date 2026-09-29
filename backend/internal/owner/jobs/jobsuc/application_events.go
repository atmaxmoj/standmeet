// application_events.go —— what an application commit records, on the commit's transaction.

package jobsuc

import (
	"context"

	"github.com/jackc/pgx/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

// ApplicationCommitted —— an application was committed. Thin: subject application/<id>, data
// {application_id, code_id}.
const ApplicationCommitted = "application.committed"

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
