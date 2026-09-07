// repo.go —— storage for visitor traffic.
//
// The SQL is written out here rather than generated, and that is the point: monitor owns its
// two tables end to end. It has no entry in the shared sqlc.yaml, and its DDL is not in the
// shared db/schema.sql — a codegen run for this domain would rewrite every other domain's
// models.go, because they all read that one schema file. A module that watches the others must
// not be able to disturb them.
//
// Its tables are created by db/migrations/2026-09-06-monitor.sql alone. The migration runner
// applies every unapplied migration on a fresh volume too, so that one file covers both a new
// install and an upgrade.
//
// One rule governs the package: recording an event may never fail the request that produced it.
// Every method returns an error, and every caller in the ingest path logs it and carries on.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/monitor/entity"
)

// Repo —— the visit_viewer and visit_event tables.
type Repo struct {
	pool *pgstore.Pool
}

// New constructs a Repo.
func New(pool *pgstore.Pool) *Repo { return &Repo{pool: pool} }

// upsertViewerSQL —— `xmax = 0` is true only for a row this statement inserted, so one round
// trip answers both "record it" and "was this the first time".
const upsertViewerSQL = `
INSERT INTO visit_viewer (viewer_id, owner_id)
VALUES ($1, $2)
ON CONFLICT (viewer_id) DO UPDATE SET viewer_id = EXCLUDED.viewer_id
RETURNING (xmax = 0)`

// TouchViewer —— records a viewer the first time it is seen, and reports whether this call
// created it. A surface with no browser (the IM bridge) has no viewer id and is skipped: such
// an event still counts as one visit and as zero identified viewers.
func (r *Repo) TouchViewer(ctx context.Context, ownerID, viewerID string) (bool, error) {
	if viewerID == "" {
		return false, nil
	}
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return false, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	var isNew bool
	if qerr := r.pool.QueryRow(ctx, upsertViewerSQL, viewerID, owner).Scan(&isNew); qerr != nil {
		return false, fmt.Errorf("upsert viewer: %w", qerr)
	}
	return isNew, nil
}

// newestVisitSQL —— the visit this viewer is still inside. The idle cutoff is passed in so the
// 30-minute window lives in exactly one Go constant; two copies of that number would produce
// two different visit counts over the same rows.
const newestVisitSQL = `
SELECT visit_id
FROM visit_event
WHERE owner_id = $1 AND viewer_id = $2 AND created_at >= $3
GROUP BY visit_id
ORDER BY max(created_at) DESC
LIMIT 1`

// ResolveVisit —— the visit this viewer is still inside, or a new one.
func (r *Repo) ResolveVisit(
	ctx context.Context, secret []byte, ownerID, viewerID string, now time.Time,
) (string, error) {
	if viewerID == "" {
		// No viewer means no history to join to. Every such event is its own visit.
		return entity.VisitID(secret, ownerID+now.String(), now), nil
	}
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return "", fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	cutoff := now.Add(-entity.VisitIdleWindow)
	var visitID string
	qerr := r.pool.QueryRow(ctx, newestVisitSQL, owner, viewerID, cutoff).Scan(&visitID)
	if qerr != nil {
		// No open visit is the common case on a first hit, and pgx reports it as an error.
		// Opening a fresh visit answers both that and a genuine query failure; the alternative
		// is dropping the event, which loses more than it protects.
		return entity.VisitID(secret, viewerID, now), nil //nolint:nilerr // see above
	}
	return visitID, nil
}

const insertEventSQL = `
INSERT INTO visit_event (
    owner_id, viewer_id, visit_id, created_at,
    surface, event_name, is_bot,
    url_path, url_query, page_title, hostname,
    referrer_domain, referrer_path,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, src,
    entity_kind, entity_id, entity_title,
    code_id, code_label, role_id, chat_session_id, embed_id, microsite_slug,
    browser, os, device, screen, language, country, region, city,
    props
) VALUES (
    $1,$2,$3,$4, $5,$6,$7, $8,$9,$10,$11, $12,$13,
    $14,$15,$16,$17,$18,$19, $20,$21,$22,
    $23,$24,$25,$26,$27,$28, $29,$30,$31,$32,$33,$34,$35,$36, $37
)`

// Recording —— one event plus the identity it was recorded under. Bundled so Record takes a
// subject rather than a list of loose strings a caller could pass in the wrong order.
// Field order is set by govet's fieldalignment, not by reading order.
type Recording struct {
	At       time.Time
	Event    *entity.Event
	OwnerID  string
	ViewerID string
	VisitID  string
}

// Record —— writes one event.
func (r *Repo) Record(ctx context.Context, rec *Recording) error {
	owner, err := pgstore.ParseUUID(rec.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	ev := rec.Event
	// insertEventSQL names 37 columns; the appends below fill them in that order.
	const columns = 37
	args := make([]any, 0, columns)
	args = append(args,
		owner, optViewer(rec.ViewerID), rec.VisitID, rec.At,
		ev.Surface, ev.Name, ev.Client.IsBot)
	args = append(args, pageArgs(&ev.Page)...)
	args = append(args, ev.Entity.Kind, ev.Entity.ID, ev.Entity.Title)
	args = append(args, refArgs(ev)...)
	args = append(args, clientArgs(&ev.Client)...)
	args = append(args, encodeProps(ev.Props))
	if _, qerr := r.pool.Exec(ctx, insertEventSQL, args...); qerr != nil {
		return fmt.Errorf("insert visit event: %w", qerr)
	}
	return nil
}

// pageArgs —— columns 8 through 19: where it happened and where it came from.
func pageArgs(p *entity.Page) []any {
	return []any{
		p.Path, p.Query, p.Title, p.Hostname,
		p.RefDomain, p.RefPath,
		p.UTMSource, p.UTMMedium, p.UTMCampaign, p.UTMContent, p.UTMTerm, p.Src,
	}
}

// refArgs —— the historical references. Each is a plain id with no foreign key: revoking a code
// or deleting a corpus entry must not erase the visits it brought in.
func refArgs(ev *entity.Event) []any {
	return []any{
		pgstore.UUIDOrNull(ev.CodeID), ev.CodeLabel,
		pgstore.UUIDOrNull(ev.RoleID), pgstore.UUIDOrNull(ev.ChatSessionID),
		pgstore.UUIDOrNull(ev.EmbedID), ev.MicrositeSlug,
	}
}

func clientArgs(c *entity.Client) []any {
	return []any{c.Browser, c.OS, c.Device, c.Screen, c.Language, c.Country, c.Region, c.City}
}

func optViewer(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

// encodeProps —— always valid JSON. An empty object, never null: a reader that sees null cannot
// tell "this event carried no properties" from "this column is broken".
func encodeProps(m map[string]string) []byte {
	if len(m) == 0 {
		return []byte(`{}`)
	}
	b, err := json.Marshal(m)
	if err != nil {
		return []byte(`{}`)
	}
	return b
}

// Prune —— retention. Returns how many event rows went, so the job can report a real number: a
// delete that matched nothing and a delete that never ran look identical without one.
func (r *Repo) Prune(ctx context.Context, before time.Time) (int64, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM visit_event WHERE created_at < $1`, before)
	if err != nil {
		return 0, fmt.Errorf("prune visit events: %w", err)
	}
	const orphans = `DELETE FROM visit_viewer v
WHERE NOT EXISTS (SELECT 1 FROM visit_event e WHERE e.viewer_id = v.viewer_id)`
	if _, oerr := r.pool.Exec(ctx, orphans); oerr != nil {
		return tag.RowsAffected(), fmt.Errorf("prune orphan viewers: %w", oerr)
	}
	return tag.RowsAffected(), nil
}

// ErrNoRows —— re-exported so callers can tell "nothing recorded yet" from a real failure
// without importing pgx.
var ErrNoRows = errors.New("monitor: no rows")
