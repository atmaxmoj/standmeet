// codes_query.go —— access_codes Get / List + the CodeFromRow conversion + JSON
// decode helpers. Split out of codes.go to respect max-lines.

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

// GetByID fetches a code (by UUID, including revoked ones); a miss returns
// ErrCodeInvalid. Used by the turn quota check: an old conversation still needs
// to look up its underlying code's max_turns.
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

// GetByCode fetches a code (active only); on a miss it **distinguishes which kind**:
// the code doesn't exist at all → ErrCodeInvalid; it exists but was revoked →
// ErrCodeRevoked.
//
// Previously this queried status='active' just once, and both cases came back as
// no-rows, so the visitor's rejection message could only be a merged "invalid or
// revoked" — even though the two people's next steps are opposite: a typo should be
// re-pasted, a revocation should be re-requested. The branch was already gone at
// this layer, so no amount of copywriting above it could tell them apart (F-D-6).
//
// The cost is one extra query on the "code is wrong" path. That path is already the
// failure path (a normal visitor hits active on the first try), so it's off the hot
// path.
func (r *CodeRepo) GetByCode(ctx context.Context, code string) (entity.Code, error) {
	q := db.New(r.pool)
	// The page-aware version: one extra LEFT JOIN to fetch the slug. The landing
	// decision (which page this code opens) has to be answerable the instant a visitor
	// arrives with a code, and the slug lives on the page table — fetching it at the
	// SQL layer means this visitor path doesn't have to cross domains.
	row, err := q.GetAccessCodeWithPage(ctx, code)
	if err == nil {
		c := CodeFromRow(&db.AccessCode{
			ID: row.ID, OwnerID: row.OwnerID, Code: row.Code, Label: row.Label,
			Purpose: row.Purpose, Ghosts: row.Ghosts, ExpiresAt: row.ExpiresAt,
			Status: row.Status, MaxTurnsPerSession: row.MaxTurnsPerSession,
			MaxMembers: row.MaxMembers, RequireGhostEvidence: row.RequireGhostEvidence,
			ProviderID: row.ProviderID, CreatedAt: row.CreatedAt,
			AssumedRoleID: row.AssumedRoleID, PromptID: row.PromptID,
			InlinePrompt: row.InlinePrompt, MicrositeID: row.MicrositeID,
		})
		c.MicrositeSlug = row.MicrositeSlug
		return c, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return entity.Code{}, fmt.Errorf("get access code: %w", err)
	}
	return entity.Code{}, r.missingCodeReason(ctx, code)
}

// missingCodeReason —— after the active query misses, asks once more "does this
// code exist at all". Not found → doesn't exist; found → was revoked/disabled.
// When the second query itself errors, falls back to ErrCodeInvalid: when it can't
// tell, say the most conservative thing, don't invent a more specific reason.
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

// ListByOwner lists codes for the admin view.
func (r *CodeRepo) ListByOwner(
	ctx context.Context, ownerID string) ([]entity.Code, error,
) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	// The page-aware version: one extra LEFT JOIN to fetch the slug, so the **code
	// side** can also see which page it opens. The binding is one fact; both panels
	// read from the same place ([[names-that-lie]]'s inverse: never store a second copy).
	rows, err := q.ListAccessCodesWithPageByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list access codes: %w", err)
	}
	out := make([]entity.Code, 0, len(rows))
	for i := range rows {
		out = append(out, codeFromListRow(&rows[i]))
	}
	return out, nil
}

func codeFromListRow(row *db.ListAccessCodesWithPageByOwnerRow) entity.Code {
	c := CodeFromRow(&db.AccessCode{
		ID: row.ID, OwnerID: row.OwnerID, Code: row.Code, Label: row.Label,
		Purpose: row.Purpose, Ghosts: row.Ghosts, ExpiresAt: row.ExpiresAt,
		Status: row.Status, MaxTurnsPerSession: row.MaxTurnsPerSession,
		MaxMembers: row.MaxMembers, RequireGhostEvidence: row.RequireGhostEvidence,
		ProviderID: row.ProviderID, CreatedAt: row.CreatedAt,
		AssumedRoleID: row.AssumedRoleID, PromptID: row.PromptID,
		InlinePrompt: row.InlinePrompt, MicrositeID: row.MicrositeID,
	})
	c.MicrositeSlug = row.MicrositeSlug
	return c
}

// CodeFromRow —— maps a db.AccessCode row → an access.Code domain object. Exported
// because jobs' application-commit (which issues an invitation code in the same
// step) also reuses this mapping.
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
		// Empty string = not specified (that column is NULL, or the row it pointed to
		// was deleted — ON DELETE SET NULL).
		ProviderID:     pgstore.UUIDStrOrEmpty(c.ProviderID),
		LimitPerPeriod: decodePeriodLimit(c.LimitPerPeriod),
	}
	if c.ExpiresAt.Valid {
		t := c.ExpiresAt.Time
		out.ExpiresAt = &t
	}
	return out
}

// decodePeriodLimit —— jsonb → *PeriodLimit. NULL / empty / malformed → nil
// (unlimited).
func decodePeriodLimit(raw []byte) *entity.PeriodLimit {
	if len(raw) == 0 {
		return nil
	}
	var p entity.PeriodLimit
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil
	}
	return &p
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
