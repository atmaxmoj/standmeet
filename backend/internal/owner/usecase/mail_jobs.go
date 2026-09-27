// mail_jobs.go —— how a use case hands mail to the job layer and reports it back.
//
// A use case never sends mail (it holds no send port). It enqueues a mail job in the transaction
// that commits the business write, then waits briefly: the response promises only what is
// committed, plus a receipt whose state can be read later (*Response contract after going async*).

package usecase

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// mailReceiptWait —— how long a request waits for its mail before answering "sending".
const mailReceiptWait = 2 * time.Second

// MailJobs —— enqueue a mail job, wait for it briefly, read its state later. The job runtime
// satisfies it.
type MailJobs interface {
	jobs.Jobs
	Wait(ctx context.Context, id jobs.JobID, maxWait time.Duration) (jobs.State, bool)
	Get(ctx context.Context, id jobs.JobID) (jobs.Job, error)
}

// MailStateOf —— a mail job's state in the three words a face shows.
func MailStateOf(st jobs.State) string {
	switch st {
	case jobs.StateCompleted:
		return entity.NoticeSent
	case jobs.StateDiscarded, jobs.StateCancelled:
		return entity.NoticeFailed
	case jobs.StatePending, jobs.StateRunning, jobs.StateRetryable:
		return entity.NoticeSending
	}
	return entity.NoticeSending
}

// awaitMail —— waits up to mailReceiptWait for the job, then reports where it is.
func awaitMail(ctx context.Context, j MailJobs, id jobs.JobID) entity.NoticeReceipt {
	st, done := j.Wait(ctx, id, mailReceiptWait)
	if !done {
		return entity.NoticeReceipt{State: entity.NoticeSending, JobID: int64(id)}
	}
	return entity.NoticeReceipt{State: MailStateOf(st), JobID: int64(id)}
}

// MailReceiptOf —— the receipt of a stored mail job id. nil when there is none: no job yet, or
// its row was already cleaned up (completed rows are kept 24 h).
func MailReceiptOf(ctx context.Context, j MailJobs, id int64) *entity.NoticeReceipt {
	if id == 0 || j == nil {
		return nil
	}
	job, err := j.Get(ctx, jobs.JobID(id))
	if err != nil {
		return nil
	}
	return &entity.NoticeReceipt{State: MailStateOf(job.State), JobID: id}
}
