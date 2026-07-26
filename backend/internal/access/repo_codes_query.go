// codes_query.go —— access_codes Get / List + CodeFromRow 转换 + JSON
// decode helpers。从 codes.go 拆出守 max-lines。

package access

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// GetByID 拿 code（按 UUID，含 revoked）；不命中返 ErrCodeInvalid。turn quota
// check 用：旧 conversation 还要查到背后 code 的 max_turns。
func (r *CodeRepo) GetByID(ctx context.Context, codeID string) (Code, error) {
	codeUUID, perr := pgstore.ParseUUID(codeID)
	if perr != nil {
		return Code{}, fmt.Errorf(errParseCodeIDPrefix, perr)
	}
	q := dbq.New(r.pool)
	row, err := q.GetAccessCodeByID(ctx, codeUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Code{}, ErrCodeInvalid
		}
		return Code{}, fmt.Errorf("get access code by id: %w", err)
	}
	return CodeFromRow(&row), nil
}

// GetByCode 拿 code（active only）；不命中返回 ErrCodeInvalid。
func (r *CodeRepo) GetByCode(ctx context.Context, code string) (Code, error) {
	q := dbq.New(r.pool)
	row, err := q.GetAccessCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Code{}, ErrCodeInvalid
		}
		return Code{}, fmt.Errorf("get access code: %w", err)
	}
	return CodeFromRow(&row), nil
}

// ListByOwner 给 admin 列 codes。
func (r *CodeRepo) ListByOwner(
	ctx context.Context, ownerID string) ([]Code, error,
) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListAccessCodesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list access codes: %w", err)
	}
	out := make([]Code, 0, len(rows))
	for i := range rows {
		out = append(out, CodeFromRow(&rows[i]))
	}
	return out, nil
}

// CodeFromRow —— dbq.AccessCode 行 → access.Code 领域对象。jobs 的 application-commit
// (同步 issue 邀请码) 也复用这个映射,故导出。
func CodeFromRow(c *dbq.AccessCode) Code {
	out := Code{
		ID:                   pgstore.FormatUUID(c.ID),
		OwnerID:              pgstore.FormatUUID(c.OwnerID),
		Code:                 c.Code,
		Label:                c.Label,
		Purpose:              c.Purpose,
		Status:               c.Status,
		CreatedAt:            c.CreatedAt.Time,
		MaxMembers:           c.MaxMembers,
		MaxTurnsPerSession:   c.MaxTurnsPerSession,
		RequireGhostEvidence: c.RequireGhostEvidence,
		Ghosts:               DecodeStringJSON(c.Ghosts),
		AssumedRoleID:        pgstore.FormatUUID(c.AssumedRoleID),
		PromptID:             pgstore.OptUUIDStr(c.PromptID),
		InlinePrompt:         c.InlinePrompt,
	}
	if c.ExpiresAt.Valid {
		t := c.ExpiresAt.Time
		out.ExpiresAt = &t
	}
	return out
}

// DecodeStringJSON decodes a JSONB string-array column into a []string, ALWAYS non-nil so it
// re-marshals as `[]` (never `null`). See TestDecodeStringJSON_NeverNil (F-D-1).
func DecodeStringJSON(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	// A JSON `null` literal unmarshals into a nil slice without error; re-marshaling that
	// nil emits JSON `null`, which the frontend's z.array().optional() rejects and blanks the
	// whole list (F-D-1). Always hand back a non-nil slice so the wire form is `[]`.
	if out == nil {
		return []string{}
	}
	return out
}
