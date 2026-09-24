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

// PrunePeriodicJobs —— the checker, for the host scheduler. r == nil → no jobs.
func PrunePeriodicJobs(r *ChatRepo, log *slog.Logger) []periodic.Job {
	if r == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"public conversation prune", pruneEvery,
		func(ctx context.Context) error { return runPrune(ctx, r, log, time.Now()) },
	)}
}

func runPrune(ctx context.Context, r *ChatRepo, log *slog.Logger, now time.Time) error {
	q := db.New(r.pool)
	rows, err := q.ListScheduledPublicPrunes(ctx)
	if err != nil {
		return fmt.Errorf("list public prunes: %w", err)
	}
	for i := range rows {
		if perr := pruneOne(ctx, q, log, &rows[i], now); perr != nil {
			return perr
		}
	}
	return nil
}

// pruneOne —— delete one owner's idle codeless conversations if the schedule is due, then move
// the mark. Logs the count (success path included) so prod shows what a run actually removed.
func pruneOne(
	ctx context.Context, q *db.Queries, log *slog.Logger,
	p *db.ListScheduledPublicPrunesRow, now time.Time,
) error {
	due, err := periodic.CronDue(p.PruneCron, p.LastRunAt.Time, now)
	if err != nil {
		// Unexpected: a malformed cron can't be stored (ValidatePublicPolicy).
		return fmt.Errorf("prune schedule: %w", err)
	}
	if !due {
		return nil
	}
	n, err := q.PruneCodelessConversations(ctx, db.PruneCodelessConversationsParams{
		OwnerID: p.OwnerID, RetentionDays: p.RetentionDays,
	})
	if err != nil {
		return fmt.Errorf("prune conversations: %w", err)
	}
	log.Info("public conversation prune", "owner", pgstore.FormatUUID(p.OwnerID),
		"retention_days", p.RetentionDays, "deleted", n)
	if merr := q.MarkPublicPruneRun(ctx, p.OwnerID); merr != nil {
		return fmt.Errorf("mark public prune: %w", merr)
	}
	return nil
}
