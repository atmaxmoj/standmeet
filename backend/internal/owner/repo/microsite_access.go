package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// SetOpenWithoutCode —— the owner's explicit "open without an access code" for one page. No
// matching row = this owner has no such live slug → ErrMicrositeNotFound, not a silent success.
func (r *MicrositeRepo) SetOpenWithoutCode(
	ctx context.Context, ownerID, slug string, open bool,
) error {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(errParseOwnerID, perr)
	}
	n, err := db.New(r.pool).SetMicrositeOpenWithoutCode(ctx, db.SetMicrositeOpenWithoutCodeParams{
		OwnerID: ownerUUID, Slug: slug, OpenWithoutCode: open,
	})
	if err != nil {
		return fmt.Errorf("set open without code: %w", err)
	}
	if n == 0 {
		return entity.ErrMicrositeNotFound
	}
	return nil
}

// OpensWithoutCode —— may this page be opened without a code (the database's one definition:
// the owner's choice, else open iff no active code is bound).
func (r *MicrositeRepo) OpensWithoutCode(ctx context.Context, pageID string) (bool, error) {
	pg, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return false, fmt.Errorf(errParsePageID, perr)
	}
	open, err := db.New(r.pool).MicrositeOpensWithoutCode(ctx, pg)
	if err != nil {
		return false, fmt.Errorf("opens without code: %w", err)
	}
	return open, nil
}

// CodeOpens —— is this code an active code bound to this page.
func (r *MicrositeRepo) CodeOpens(ctx context.Context, codeID, pageID string) (bool, error) {
	code, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return false, fmt.Errorf("parse code id: %w", cerr)
	}
	pg, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return false, fmt.Errorf(errParsePageID, perr)
	}
	opens, err := db.New(r.pool).CodeOpensMicrosite(ctx, db.CodeOpensMicrositeParams{
		CodeID: code, PageID: pg,
	})
	if err != nil {
		return false, fmt.Errorf("code opens page: %w", err)
	}
	return opens, nil
}
