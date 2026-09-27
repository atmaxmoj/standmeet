// public_policy.go —— how the owner keeps codeless (public / byoai) conversations.
//
// Public and BYOAI chat is open to anyone, so its conversation rows can grow without bound. The
// owner decides two things: whether those turns are saved at all (Save=false → their messages are
// never written), and a cron + retention that deletes codeless conversations idle longer than the
// retention whenever the cron has ticked since the last run. No row = save, no prune (today's
// behaviour). Coded conversations are never affected (the queries key on mode, not code_id).

package repo

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// DefaultPruneRetentionDays —— what an owner who never set a policy sees in the form.
const DefaultPruneRetentionDays = 30

// PublicPolicy —— one owner's policy for codeless conversations. PruneCron "" = no prune.
type PublicPolicy struct {
	LastRunAt     time.Time
	PruneCron     string
	RetentionDays int32
	Save          bool
}

// ValidatePublicPolicy —— the write-boundary rule: a parseable cron (or "" for off) and at least
// a day of retention, so a typo can't turn into "delete every conversation right now".
func ValidatePublicPolicy(p *PublicPolicy) error {
	if err := periodic.ValidCron(p.PruneCron); err != nil {
		return fmt.Errorf("invalid schedule: %w", err)
	}
	if p.RetentionDays < 1 {
		return errors.New("retention must be at least 1 day")
	}
	return nil
}

// GetPublicPolicy —— the owner's policy; no row reads as save + no prune.
func (r *ChatRepo) GetPublicPolicy(ctx context.Context, ownerID string) (PublicPolicy, error) {
	uid, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return PublicPolicy{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).GetPublicConversationPolicy(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicPolicy{Save: true, RetentionDays: DefaultPruneRetentionDays}, nil
	}
	if err != nil {
		return PublicPolicy{}, fmt.Errorf("get public conversation policy: %w", err)
	}
	return PublicPolicy{
		Save: row.Save, PruneCron: row.PruneCron, RetentionDays: row.RetentionDays,
		LastRunAt: row.LastRunAt.Time,
	}, nil
}

// SetPublicPolicy —— store the owner's policy (callers validate first with ValidatePublicPolicy).
func (r *ChatRepo) SetPublicPolicy(
	ctx context.Context, ownerID string, p *PublicPolicy,
) (PublicPolicy, error) {
	uid, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return PublicPolicy{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := db.New(r.pool).UpsertPublicConversationPolicy(ctx,
		db.UpsertPublicConversationPolicyParams{
			OwnerID: uid, Save: p.Save, PruneCron: p.PruneCron, RetentionDays: p.RetentionDays,
		})
	if err != nil {
		return PublicPolicy{}, fmt.Errorf("set public conversation policy: %w", err)
	}
	return PublicPolicy{
		Save: row.Save, PruneCron: row.PruneCron, RetentionDays: row.RetentionDays,
		LastRunAt: row.LastRunAt.Time,
	}, nil
}

// SavesMessages —— whether a turn on this conversation may be written: coded always, codeless
// unless the owner turned saving off. An unknown conversation answers true, so the write path
// reports its own not-found instead of silently dropping the turn.
func (r *ChatRepo) SavesMessages(ctx context.Context, chatID string) (bool, error) {
	uid, perr := pgstore.ParseUUID(chatID)
	if perr != nil {
		return false, fmt.Errorf("parse chat id: %w", perr)
	}
	saves, err := db.New(r.pool).ConversationSavesMessages(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("conversation saves messages: %w", err)
	}
	return saves == nil || *saves, nil
}

// pruneEvery —— how often the checker looks. The cron decides WHEN; this only bounds the lag.
const pruneEvery = 5 * time.Minute

// PrunedHook —— runs on the prune's transaction after an owner's conversations were deleted
// (n > 0), so what it writes commits with the delete.
type PrunedHook func(ctx context.Context, tx pgstore.Tx, ownerID string, n int64) error

// PrunePeriodicJobs —— the checker, for the host scheduler. r == nil → no jobs.
func PrunePeriodicJobs(r *ChatRepo, log *slog.Logger, pruned PrunedHook) []periodic.Job {
	if r == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"public conversation prune", pruneEvery,
		func(ctx context.Context) error {
			return (&pruneRun{r: r, log: log, pruned: pruned, now: time.Now()}).all(ctx)
		},
	)}
}

// pruneRun —— one pass of the checker over every owner with a schedule.
type pruneRun struct {
	now    time.Time
	r      *ChatRepo
	log    *slog.Logger
	pruned PrunedHook
}

func (p *pruneRun) all(ctx context.Context) error {
	rows, err := db.New(p.r.pool).ListScheduledPublicPrunes(ctx)
	if err != nil {
		return fmt.Errorf("list public prunes: %w", err)
	}
	for i := range rows {
		if perr := p.owner(ctx, &rows[i]); perr != nil {
			return perr
		}
	}
	return nil
}

// owner —— one owner's prune and the hook's writes, in one transaction.
func (p *pruneRun) owner(ctx context.Context, row *db.ListScheduledPublicPrunesRow) error {
	//nolint:wrapcheck // pruneOne and the hook name their steps
	return pgstore.InTx(ctx, p.r.pool, func(tx pgstore.Tx) error {
		n, err := pruneOne(ctx, db.New(tx), p.log, row, p.now)
		if err != nil || n == 0 {
			return err
		}
		return p.pruned(ctx, tx, pgstore.FormatUUID(row.OwnerID), n)
	})
}

// pruneOne —— delete one owner's idle codeless conversations if the schedule is due, then move
// the mark; returns how many went. Logs the count (success path included) so prod shows what a
// run actually removed.
func pruneOne(
	ctx context.Context, q *db.Queries, log *slog.Logger,
	p *db.ListScheduledPublicPrunesRow, now time.Time,
) (int64, error) {
	due, err := periodic.CronDue(p.PruneCron, p.LastRunAt.Time, now)
	if err != nil {
		// Unexpected: a malformed cron can't be stored (ValidatePublicPolicy).
		return 0, fmt.Errorf("prune schedule: %w", err)
	}
	if !due {
		return 0, nil
	}
	n, err := q.PruneCodelessConversations(ctx, db.PruneCodelessConversationsParams{
		OwnerID: p.OwnerID, RetentionDays: p.RetentionDays,
	})
	if err != nil {
		return 0, fmt.Errorf("prune conversations: %w", err)
	}
	log.Info("public conversation prune", "owner", pgstore.FormatUUID(p.OwnerID),
		"retention_days", p.RetentionDays, "deleted", n)
	if merr := q.MarkPublicPruneRun(ctx, p.OwnerID); merr != nil {
		return 0, fmt.Errorf("mark public prune: %w", merr)
	}
	return n, nil
}
