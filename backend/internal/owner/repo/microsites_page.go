// microsites_page.go —— the paged admin read of microsites (docs/design/paging.md). Split out
// of microsites.go, which keeps the per-page CRUD.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// MicrositeFilter —— which pages a list page holds: Slug (exact; empty = all), Scope ("pages" =
// all but the homepage), Q (slug or title substring).
type MicrositeFilter struct {
	Slug  string `json:"slug"`
	Scope string `json:"scope"`
	Q     string `json:"q"`
}

// ListPage —— one page of the admin list, newest first, narrowed by f; the page reports how
// many match.
func (r *MicrositeRepo) ListPage(
	ctx context.Context, ownerID string, f MicrositeFilter, req paging.Request,
) (paging.Page[entity.Microsite], error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return paging.Page[entity.Microsite]{}, fmt.Errorf(errParseOwnerID, perr)
	}
	after, err := pgstore.CursorArgs(req.After)
	if err != nil {
		return paging.Page[entity.Microsite]{}, fmt.Errorf("list microsites: %w", err)
	}
	rows, err := db.New(r.pool).ListMicrositesPage(ctx, db.ListMicrositesPageParams{
		OwnerID: ownerUUID, Slug: f.Slug, Scope: f.Scope, Q: f.Q,
		AfterAt: after.At, AfterID: after.ID, Lim: req.Fetch(),
	})
	if err != nil {
		return paging.Page[entity.Microsite]{}, fmt.Errorf("list microsites: %w", err)
	}
	out := make([]entity.Microsite, 0, len(rows))
	total := int32(0)
	for i := range rows {
		row := asListedRow(&rows[i])
		out = append(out, listedMicrosite(&row))
		total = rows[i].Total
	}
	return paging.Cut(out, req, func(m *entity.Microsite) paging.Cursor {
		return paging.Cursor{At: m.CreatedAt, ID: m.ID}
	}).WithTotal(total), nil
}

// asListedRow —— a page row's columns without its total: the full-list row listedMicrosite reads.
func asListedRow(r *db.ListMicrositesPageRow) db.ListMicrositesByOwnerRow {
	return db.ListMicrositesByOwnerRow{
		ID: r.ID, OwnerID: r.OwnerID, Slug: r.Slug, Title: r.Title, Status: r.Status,
		LiveBuildID: r.LiveBuildID, StagingBuildID: r.StagingBuildID,
		PreviousLiveBuildID: r.PreviousLiveBuildID, AllowByoai: r.AllowByoai,
		StoreWritable: r.StoreWritable, SeoTitle: r.SeoTitle, SeoDescription: r.SeoDescription,
		SeoImage: r.SeoImage, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		BoundCodes: r.BoundCodes,
	}
}
