// roles_page.go —— the paged admin read of roles (docs/design/paging.md). Split out of
// roles.go, which keeps the role CRUD.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ListPage —— one page of the admin /admin/roles listing, oldest first (the builtin public role
// leads), narrowed by a name search; the page reports how many match. Returned Roles have their
// three join groups hydrated (N+1 per row, bounded by the page size).
func (r *RoleRepo) ListPage(
	ctx context.Context, ownerID, search string, req paging.Request,
) (paging.Page[entity.Role], error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return paging.Page[entity.Role]{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	after, err := pgstore.CursorArgs(req.After)
	if err != nil {
		return paging.Page[entity.Role]{}, fmt.Errorf("list roles: %w", err)
	}
	q := db.New(r.pool)
	rows, err := q.ListRolesPage(ctx, db.ListRolesPageParams{
		OwnerID: ownerUUID, Q: search, AfterAt: after.At, AfterID: after.ID, Lim: req.Fetch(),
	})
	if err != nil {
		return paging.Page[entity.Role]{}, fmt.Errorf("list roles: %w", err)
	}
	return hydratedPage(ctx, q, rows, req)
}

// hydratedPage —— each row with its join groups, cut to the page, with the matching total.
func hydratedPage(
	ctx context.Context, q *db.Queries, rows []db.ListRolesPageRow, req paging.Request,
) (paging.Page[entity.Role], error) {
	out := make([]entity.Role, 0, len(rows))
	total := int32(0)
	for i := range rows {
		hydrated, herr := hydrateRole(ctx, q, &rows[i].Role)
		if herr != nil {
			return paging.Page[entity.Role]{}, herr
		}
		out = append(out, hydrated)
		total = rows[i].Total
	}
	return paging.Cut(out, req, func(ro *entity.Role) paging.Cursor {
		return paging.Cursor{At: ro.CreatedAt(), ID: ro.ID()}
	}).WithTotal(total), nil
}
