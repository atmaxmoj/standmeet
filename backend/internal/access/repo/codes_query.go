// codes_query.go —— access_codes Get / List + CodeFromRow 转换 + JSON
// decode helpers。从 codes.go 拆出守 max-lines。

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GetByID 拿 code（按 UUID，含 revoked）；不命中返 ErrCodeInvalid。turn quota
// check 用：旧 conversation 还要查到背后 code 的 max_turns。
func (r *CodeRepo) GetByID(ctx context.Context, codeID string) (entity.Code, error) {
	codeUUID, perr := pgstore.ParseUUID(codeID)
	if perr != nil {
		return entity.Code{}, fmt.Errorf(errParseCodeIDPrefix, perr)
	}
	q := db.New(r.pool)
	row, err := q.GetAccessCodeByID(ctx, codeUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Code{}, entity.ErrCodeInvalid
		}
		return entity.Code{}, fmt.Errorf("get access code by id: %w", err)
	}
	return CodeFromRow(&row), nil
}

// GetByCode 拿 code（active only）；不命中时**分得出是哪一种**：这张码根本不存在 →
// ErrCodeInvalid；存在但被撤销了 → ErrCodeRevoked。
//
// 以前这里只按 status='active' 查一次,两种都是 no-rows,于是访客那句拒绝只能合成
// 「invalid or revoked」—— 而这两种人的下一步是相反的:打错字该重新粘一次,被撤销该去要
// 一张新的。分支在这一层就没了,上面再怎么写文案也分不出来(F-D-6)。
//
// 代价是「码不对」这条路多一次查询。这条路本来就是失败路径(正常访客第一次就命中 active),
// 不在热路上。
func (r *CodeRepo) GetByCode(ctx context.Context, code string) (entity.Code, error) {
	q := db.New(r.pool)
	// 带页的那一版：多一个 LEFT JOIN 取 slug。落地决定（这张码开哪一页）要在访客带码
	// 进来的那一刻就答得出来，而 slug 在页那张表上 —— 在 SQL 层取，访客这条路就不必跨域。
	row, err := q.GetAccessCodeWithPage(ctx, code)
	if err == nil {
		c := CodeFromRow(&db.AccessCode{
			ID: row.ID, OwnerID: row.OwnerID, Code: row.Code, Label: row.Label,
			Purpose: row.Purpose, Ghosts: row.Ghosts, ExpiresAt: row.ExpiresAt,
			Status: row.Status, MaxTurnsPerSession: row.MaxTurnsPerSession,
			MaxMembers: row.MaxMembers, RequireGhostEvidence: row.RequireGhostEvidence,
			ProviderID: row.ProviderID, CreatedAt: row.CreatedAt,
			AssumedRoleID: row.AssumedRoleID, PromptID: row.PromptID,
			InlinePrompt: row.InlinePrompt, CustomPageID: row.CustomPageID,
		})
		c.CustomPageSlug = row.CustomPageSlug
		return c, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return entity.Code{}, fmt.Errorf("get access code: %w", err)
	}
	return entity.Code{}, r.missingCodeReason(ctx, code)
}

// missingCodeReason —— active 那次没命中之后,再问一次「这张码到底存不存在」。
// 查不到 → 不存在;查得到 → 是被撤销/停用了。第二次查询本身出错时退回 ErrCodeInvalid:
// 说不清就说最保守的那一种,不编一个更具体的原因。
func (r *CodeRepo) missingCodeReason(ctx context.Context, code string) error {
	row, err := db.New(r.pool).GetAccessCodeAnyStatus(ctx, code)
	if err != nil {
		return entity.ErrCodeInvalid
	}
	if row.Status == entity.CodeStatusRevoked {
		return entity.ErrCodeRevoked
	}
	return entity.ErrCodeInvalid
}

// ListByOwner 给 admin 列 codes。
func (r *CodeRepo) ListByOwner(
	ctx context.Context, ownerID string) ([]entity.Code, error,
) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListAccessCodesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list access codes: %w", err)
	}
	out := make([]entity.Code, 0, len(rows))
	for i := range rows {
		out = append(out, CodeFromRow(&rows[i]))
	}
	return out, nil
}

// CodeFromRow —— db.AccessCode 行 → access.Code 领域对象。jobs 的 application-commit
// (同步 issue 邀请码) 也复用这个映射,故导出。
func CodeFromRow(c *db.AccessCode) entity.Code {
	out := entity.Code{
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
		// 空串 = 没指(那一列 NULL,或者指着的那条被删了 —— ON DELETE SET NULL)。
		ProviderID: pgstore.UUIDStrOrEmpty(c.ProviderID),
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
