// chat_reports.go — I.3: CRUD for the chat_reports table. #129 one report per
// conversation: upsert by conversation_id — a second summarize_conversation call
// revises the existing row (revise); report_id stays stable, no duplicate report
// gets appended.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ChatReportRepo — access entry point for the chat_reports table.
type ChatReportRepo struct {
	pool *pgstore.Pool
}

// NewChatReportRepo — DI constructor.
func NewChatReportRepo(pool *pgstore.Pool) *ChatReportRepo {
	return &ChatReportRepo{pool: pool}
}

// UpsertReportInput — Upsert input.
type UpsertReportInput struct {
	OwnerID        string
	ConversationID string
	HTML           string
}

// Upsert — #129 one report per conversation: if the conversation already has a
// report, rewrite its html (revise) and return the same row; otherwise create one.
// Returns a ChatReport (report_id stays stable).
func (r *ChatReportRepo) Upsert(
	ctx context.Context, in *UpsertReportInput,
) (entity.ChatReport, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.ChatReport{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	convUUID, err := pgstore.ParseUUID(in.ConversationID)
	if err != nil {
		return entity.ChatReport{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := db.New(r.pool).UpsertChatReport(ctx, db.UpsertChatReportParams{
		OwnerID: ownerUUID, ConversationID: convUUID, Html: in.HTML,
	})
	if qerr != nil {
		return entity.ChatReport{}, fmt.Errorf("upsert chat report: %w", qerr)
	}
	return toDomainChatReport(&row), nil
}

// GetByID — fetches for GET /report/{id}. Not found translates to ErrReportNotFound.
// Caller checks owner_id matches the session's owner (a visitor session must not be
// able to read across owners via id).
func (r *ChatReportRepo) GetByID(
	ctx context.Context, reportID string,
) (entity.ChatReport, error) {
	reportUUID, err := pgstore.ParseUUID(reportID)
	if err != nil {
		return entity.ChatReport{}, fmt.Errorf("parse report id: %w", err)
	}
	row, qerr := db.New(r.pool).GetChatReport(ctx, reportUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.ChatReport{}, entity.ErrReportNotFound
		}
		return entity.ChatReport{}, fmt.Errorf("get chat report: %w", qerr)
	}
	return toDomainChatReport(&row), nil
}

func toDomainChatReport(row *db.ChatReport) entity.ChatReport {
	return entity.ChatReport{
		ID:             pgstore.FormatUUID(row.ID),
		OwnerID:        pgstore.FormatUUID(row.OwnerID),
		ConversationID: pgstore.FormatUUID(row.ConversationID),
		HTML:           row.Html,
		CreatedAt:      row.CreatedAt.Time,
	}
}
