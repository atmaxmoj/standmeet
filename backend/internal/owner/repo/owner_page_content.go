// owner_page_content.go —— the "public page content" facet of the Owner
// aggregate (parallel to identity / settings). Physically page_content is
// its own table (FK to owners.id), but at the aggregate boundary it shares
// Owner's transaction boundary, so these are methods on Repo rather than a
// standalone PageRepo. The jsonb columns are marshaled / unmarshaled at the
// Repo layer, so usecase / routes get a typed PageContent.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// GetPageContent gets the owner's page_content; returns ErrPageNotFound if
// it doesn't exist (the usecase layer falls back to defaults).
func (r *Repo) GetPageContent(
	ctx context.Context, ownerID string,
) (entity.PageContent, error) {
	q := db.New(r.pool)
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.PageContent{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := q.GetPageContent(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return entity.PageContent{}, entity.ErrPageNotFound
		}
		return entity.PageContent{}, fmt.Errorf("get page content: %w", err)
	}
	return rowToPageContent(&row)
}

// UpsertPageContent writes / updates the owner's page_content (used by the
// admin PUT route).
func (r *Repo) UpsertPageContent(
	ctx context.Context, ownerID string, in *entity.PageContent,
) (entity.PageContent, error) {
	q := db.New(r.pool)
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.PageContent{}, fmt.Errorf("parse owner id: %w", perr)
	}
	params, perr := pageContentToParams(pgID, in)
	if perr != nil {
		return entity.PageContent{}, perr
	}
	row, err := q.UpsertPageContent(ctx, params)
	if err != nil {
		return entity.PageContent{}, fmt.Errorf("upsert page content: %w", err)
	}
	return rowToPageContent(&row)
}

// marshaledSections —— used to split up pageContentToParams: folds 5
// json.Marshal calls into one helper, keeping cyclop ≤ 5.
type marshaledSections struct {
	examples, insights, projects, where, contact []byte
}

func marshalSections(in *entity.PageContent) (marshaledSections, error) {
	var out marshaledSections
	// Field order follows govet fieldalignment: src (interface, 2 ptrs)
	// first, dst (slice ptr, 1 ptr) in the middle, name (string, 1 ptr)
	// last.
	parts := []struct {
		src  any
		dst  *[]byte
		name string
	}{
		{in.HeroExamples, &out.examples, "hero_examples"},
		{in.Insights, &out.insights, "insights"},
		{in.Projects, &out.projects, "projects"},
		{in.Where, &out.where, "where"},
		{in.Contact, &out.contact, "contact"},
	}
	for i := range parts {
		b, err := json.Marshal(parts[i].src)
		if err != nil {
			return marshaledSections{}, fmt.Errorf("marshal %s: %w", parts[i].name, err)
		}
		*parts[i].dst = b
	}
	return out, nil
}

func pageContentToParams(
	pgID pgtype.UUID, in *entity.PageContent,
) (db.UpsertPageContentParams, error) {
	sections, err := marshalSections(in)
	if err != nil {
		return db.UpsertPageContentParams{}, err
	}
	return db.UpsertPageContentParams{
		OwnerID:      pgID,
		HeroProse:    in.HeroProse,
		HeroExamples: sections.examples,
		Insights:     sections.insights,
		Projects:     sections.projects,
		WhereSection: sections.where,
		Contact:      sections.contact,
	}, nil
}

func rowToPageContent(row *db.PageContent) (entity.PageContent, error) {
	pc := entity.PageContent{
		OwnerID:   pgstore.FormatUUID(row.OwnerID),
		HeroProse: row.HeroProse,
		UpdatedAt: row.UpdatedAt.Time,
	}
	if err := unmarshalSections(row, &pc); err != nil {
		return entity.PageContent{}, err
	}
	return pc, nil
}

func unmarshalSections(row *db.PageContent, pc *entity.PageContent) error {
	// Field order follows govet fieldalignment: dst (interface, 2 ptrs)
	// first, name (string, 1 ptr) in the middle, raw (slice, whose
	// len/cap trailer has no ptr) last.
	parts := []struct {
		dst  any
		name string
		raw  []byte
	}{
		{&pc.HeroExamples, "hero_examples", row.HeroExamples},
		{&pc.Insights, "insights", row.Insights},
		{&pc.Projects, "projects", row.Projects},
		{&pc.Where, "where_section", row.WhereSection},
		{&pc.Contact, "contact", row.Contact},
	}
	for i := range parts {
		if err := json.Unmarshal(parts[i].raw, parts[i].dst); err != nil {
			return fmt.Errorf("unmarshal %s: %w", parts[i].name, err)
		}
	}
	return nil
}
