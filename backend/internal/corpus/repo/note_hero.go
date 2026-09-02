// note_hero.go — the hero section of a corpus note, plus its body (which holds the asset
// references).
//
// **Cross-genre**: assets don't care which genre they're on — a raw note and a writing attach
// a cover image the same way. The three columns cover_image_asset_id / cover_headline /
// cover_hue already lived on the shared corpus_notes table, but only the writing path ever
// wrote them, so "every genre can have a hero" was true in the data but not true in the code.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// NoteHeroRepo — the hero section on a note, for any genre.
type NoteHeroRepo struct {
	pool *pgstore.Pool
}

// NewNoteHeroRepo constructs one.
func NewNoteHeroRepo(pool *pgstore.Pool) *NoteHeroRepo { return &NoteHeroRepo{pool: pool} }

// Get — read a note's body plus the three hero fields. Missing / not this owner's →
// ErrEntryNotFound.
func (r *NoteHeroRepo) Get(ctx context.Context, ownerID, noteID string) (entity.NoteHero, error) {
	ids, perr := heroIDs(ownerID, noteID)
	if perr != nil {
		return entity.NoteHero{}, perr
	}
	row, err := db.New(r.pool).GetNoteHero(ctx, db.GetNoteHeroParams{
		ID: ids.note, OwnerID: ids.owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.NoteHero{}, entity.ErrEntryNotFound
		}
		return entity.NoteHero{}, fmt.Errorf("get note hero: %w", err)
	}
	return entity.NoteHero{
		Body:          row.Body,
		CoverAssetID:  pgstore.FormatUUID(row.CoverImageAssetID),
		CoverHeadline: row.CoverHeadline,
		CoverHue:      row.CoverHue,
	}, nil
}

// Set — writes back all three hero fields as a whole. **The caller is responsible for
// Get-ing first and overwriting only the fields it means to change** — all three columns
// are written in one go, so any field the caller doesn't mean to touch must come back with
// its current value, or it gets silently wiped.
func (r *NoteHeroRepo) Set(ctx context.Context, ownerID, noteID string, h *entity.NoteHero) error {
	ids, perr := heroIDs(ownerID, noteID)
	if perr != nil {
		return perr
	}
	cover, cerr := optionalAssetUUID(h.CoverAssetID)
	if cerr != nil {
		return cerr
	}
	_, err := db.New(r.pool).SetNoteHero(ctx, db.SetNoteHeroParams{
		ID: ids.note, OwnerID: ids.owner, CoverImageAssetID: cover,
		CoverHeadline: h.CoverHeadline, CoverHue: h.CoverHue,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.ErrEntryNotFound
		}
		return fmt.Errorf("set note hero: %w", err)
	}
	return nil
}

// heroIDs — parses both ids together, so each call site doesn't repeat the pair.
type heroIDPair struct{ note, owner pgtype.UUID }

func heroIDs(ownerID, noteID string) (heroIDPair, error) {
	noteUUID, nerr := pgstore.ParseUUID(noteID)
	if nerr != nil {
		return heroIDPair{}, entity.ErrEntryNotFound
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return heroIDPair{}, fmt.Errorf("parse owner id: %w", oerr)
	}
	return heroIDPair{note: noteUUID, owner: ownerUUID}, nil
}

// optionalAssetUUID — empty string means "remove the hero image" (write NULL).
func optionalAssetUUID(id string) (pgtype.UUID, error) {
	if id == "" {
		return pgtype.UUID{}, nil
	}
	u, err := pgstore.ParseUUID(id)
	if err != nil {
		return pgtype.UUID{}, entity.ErrAssetNotFound
	}
	return u, nil
}
