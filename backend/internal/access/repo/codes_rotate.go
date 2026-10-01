package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// RotateCode —— changes a code's `code` STRING (leak recovery). owner-scoped; a collision with an
// existing code surfaces as ErrCodeTaken (the same citext-unique path as create), a missing/foreign
// row as ErrCodeInvalid. Everything keyed on the code id (embeds, applications, live sessions) is
// untouched — only the literal string in distributed artifacts (QR/PDF, ?code= links) changes.
func (r *CodeRepo) RotateCode(
	ctx context.Context, ownerID, codeID, newCode string,
) (entity.Code, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Code{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	codeUUID, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return entity.Code{}, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	row, qerr := db.New(r.pool).UpdateAccessCodeCode(ctx, db.UpdateAccessCodeCodeParams{
		ID: codeUUID, OwnerID: ownerUUID, Code: newCode,
	})
	if qerr != nil {
		return entity.Code{}, mapRotateCodeErr(qerr)
	}
	return CodeFromRow(&row), nil
}

// mapRotateCodeErr — a collision on the citext-unique code → ErrCodeTaken; a missing/foreign row →
// ErrCodeInvalid; anything else is wrapped.
func mapRotateCodeErr(err error) error {
	if taken := uniqueCodeErr(err); taken != nil {
		return taken
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrCodeInvalid
	}
	return fmt.Errorf("rotate access code: %w", err)
}

// uniqueCodeErr — which of a code's two unique names a write collided on, or nil.
func uniqueCodeErr(err error) error {
	switch name, _ := pgstore.UniqueViolation(err); name {
	case "access_codes_code_key":
		return entity.ErrCodeTaken
	case "access_codes_owner_slug_idx":
		return entity.ErrSlugTaken
	}
	return nil
}

// SetSlug —— renames the code's landing path. A slug another of the owner's codes holds →
// ErrSlugTaken; a missing/foreign row → ErrCodeInvalid.
func (r *CodeRepo) SetSlug(ctx context.Context, ownerID, codeID, slug string) (entity.Code, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Code{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	codeUUID, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return entity.Code{}, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	row, qerr := db.New(r.pool).UpdateAccessCodeSlug(ctx, db.UpdateAccessCodeSlugParams{
		ID: codeUUID, OwnerID: ownerUUID, Slug: slug,
	})
	if qerr != nil {
		return entity.Code{}, mapRotateCodeErr(qerr)
	}
	return CodeFromRow(&row), nil
}
