// codes_query.go —— access_codes Get / List + toDomainCode 转换 + JSON
// decode helpers。从 codes.go 拆出守 max-lines。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// GetByID 拿 code（按 UUID，含 revoked）；不命中返 ErrCodeInvalid。turn quota
// check 用：旧 conversation 还要查到背后 code 的 max_turns。
func (r *CodeRepo) GetByID(ctx context.Context, codeID string) (domain.AccessCode, error) {
	codeUUID, perr := parseUUID(codeID)
	if perr != nil {
		return domain.AccessCode{}, fmt.Errorf(errParseCodeIDPrefix, perr)
	}
	q := dbq.New(r.pool)
	row, err := q.GetAccessCodeByID(ctx, codeUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("get access code by id: %w", err)
	}
	return toDomainCode(&row), nil
}

// GetByCode 拿 code（active only）；不命中返回 ErrCodeInvalid。
func (r *CodeRepo) GetByCode(ctx context.Context, code string) (domain.AccessCode, error) {
	q := dbq.New(r.pool)
	row, err := q.GetAccessCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("get access code: %w", err)
	}
	return toDomainCode(&row), nil
}

// ListByOwner 给 admin 列 codes。
func (r *CodeRepo) ListByOwner(ctx context.Context, ownerID string) ([]domain.AccessCode, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListAccessCodesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list access codes: %w", err)
	}
	out := make([]domain.AccessCode, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainCode(&rows[i]))
	}
	return out, nil
}

func toDomainCode(c *dbq.AccessCode) domain.AccessCode {
	out := domain.AccessCode{
		ID:                   formatUUID(c.ID),
		OwnerID:              formatUUID(c.OwnerID),
		Code:                 c.Code,
		Label:                c.Label,
		Purpose:              c.Purpose,
		Status:               c.Status,
		CreatedAt:            c.CreatedAt.Time,
		MaxSessionsPerMember: c.MaxSessionsPerMember,
		MaxTurnsPerSession:   c.MaxTurnsPerSession,
		MaxBookings:          c.MaxBookings,
		SuggestedQuestions:   decodeStringJSON(c.SuggestedQuestions),
		AssumedRoleID:        formatUUID(c.AssumedRoleID),
	}
	if c.ExpiresAt.Valid {
		t := c.ExpiresAt.Time
		out.ExpiresAt = &t
	}
	return out
}

func decodeStringJSON(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	return out
}
