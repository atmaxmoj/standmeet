// chat_reports.go —— I.3: chat_reports 表的 CRUD。append-only (每次
// summarize_conversation 调存一份；不 update 老 row 让 owner 看到生成
// 历史)。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// ChatReportRepo —— chat_reports 表的访问入口。
type ChatReportRepo struct {
	pool *Pool
}

// NewChatReportRepo —— DI 构造。
func NewChatReportRepo(pool *Pool) *ChatReportRepo {
	return &ChatReportRepo{pool: pool}
}

// CreateReportInput —— Create 入参。
type CreateReportInput struct {
	OwnerID        string
	ConversationID string
	HTML           string
}

// Create —— 写一行 chat_report 返 domain.ChatReport。
func (r *ChatReportRepo) Create(
	ctx context.Context, in *CreateReportInput,
) (domain.ChatReport, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.ChatReport{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return domain.ChatReport{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := dbq.New(r.pool).CreateChatReport(ctx, dbq.CreateChatReportParams{
		OwnerID: ownerUUID, ConversationID: convUUID, Html: in.HTML,
	})
	if qerr != nil {
		return domain.ChatReport{}, fmt.Errorf("create chat report: %w", qerr)
	}
	return toDomainChatReport(&row), nil
}

// GetByID —— GET /report/{id} 拿。找不到翻 ErrReportNotFound。
// 调用方校 owner_id 跟 session 的 owner 一致 (visitor session 不该
// 通过 id 跨 owner 读)。
func (r *ChatReportRepo) GetByID(
	ctx context.Context, reportID string,
) (domain.ChatReport, error) {
	reportUUID, err := parseUUID(reportID)
	if err != nil {
		return domain.ChatReport{}, fmt.Errorf("parse report id: %w", err)
	}
	row, qerr := dbq.New(r.pool).GetChatReport(ctx, reportUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.ChatReport{}, domain.ErrReportNotFound
		}
		return domain.ChatReport{}, fmt.Errorf("get chat report: %w", qerr)
	}
	return toDomainChatReport(&row), nil
}

// ListByConversation —— 某 conversation 的全 reports，新 → 老。
func (r *ChatReportRepo) ListByConversation(
	ctx context.Context, ownerID, conversationID string,
) ([]domain.ChatReport, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(conversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	rows, qerr := dbq.New(r.pool).ListChatReportsByConversation(ctx,
		dbq.ListChatReportsByConversationParams{
			ConversationID: convUUID, OwnerID: ownerUUID,
		})
	if qerr != nil {
		return nil, fmt.Errorf("list chat reports: %w", qerr)
	}
	out := make([]domain.ChatReport, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainChatReport(&rows[i]))
	}
	return out, nil
}

func toDomainChatReport(row *dbq.ChatReport) domain.ChatReport {
	return domain.ChatReport{
		ID:             formatUUID(row.ID),
		OwnerID:        formatUUID(row.OwnerID),
		ConversationID: formatUUID(row.ConversationID),
		HTML:           row.Html,
		CreatedAt:      row.CreatedAt.Time,
	}
}
