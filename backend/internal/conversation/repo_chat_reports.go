// chat_reports.go —— I.3: chat_reports 表的 CRUD。#129 一会话一份:按
// conversation_id upsert —— 第二次 summarize_conversation 改写原行(revise)，
// report_id 稳定，不 append 出重复报告。

package conversation

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// ChatReportRepo —— chat_reports 表的访问入口。
type ChatReportRepo struct {
	pool *pgstore.Pool
}

// NewChatReportRepo —— DI 构造。
func NewChatReportRepo(pool *pgstore.Pool) *ChatReportRepo {
	return &ChatReportRepo{pool: pool}
}

// UpsertReportInput —— Upsert 入参。
type UpsertReportInput struct {
	OwnerID        string
	ConversationID string
	HTML           string
}

// Upsert —— #129 一会话一份:conversation 已有 report 则改写 html(revise) 返同一行,
// 否则新建。返 ChatReport(report_id 稳定)。
func (r *ChatReportRepo) Upsert(
	ctx context.Context, in *UpsertReportInput,
) (ChatReport, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return ChatReport{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	convUUID, err := pgstore.ParseUUID(in.ConversationID)
	if err != nil {
		return ChatReport{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := dbq.New(r.pool).UpsertChatReport(ctx, dbq.UpsertChatReportParams{
		OwnerID: ownerUUID, ConversationID: convUUID, Html: in.HTML,
	})
	if qerr != nil {
		return ChatReport{}, fmt.Errorf("upsert chat report: %w", qerr)
	}
	return toDomainChatReport(&row), nil
}

// GetByID —— GET /report/{id} 拿。找不到翻 ErrReportNotFound。
// 调用方校 owner_id 跟 session 的 owner 一致 (visitor session 不该
// 通过 id 跨 owner 读)。
func (r *ChatReportRepo) GetByID(
	ctx context.Context, reportID string,
) (ChatReport, error) {
	reportUUID, err := pgstore.ParseUUID(reportID)
	if err != nil {
		return ChatReport{}, fmt.Errorf("parse report id: %w", err)
	}
	row, qerr := dbq.New(r.pool).GetChatReport(ctx, reportUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ChatReport{}, ErrReportNotFound
		}
		return ChatReport{}, fmt.Errorf("get chat report: %w", qerr)
	}
	return toDomainChatReport(&row), nil
}

func toDomainChatReport(row *dbq.ChatReport) ChatReport {
	return ChatReport{
		ID:             pgstore.FormatUUID(row.ID),
		OwnerID:        pgstore.FormatUUID(row.OwnerID),
		ConversationID: pgstore.FormatUUID(row.ConversationID),
		HTML:           row.Html,
		CreatedAt:      row.CreatedAt.Time,
	}
}
