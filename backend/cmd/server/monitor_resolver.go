// monitor_resolver.go —— binds monitor's Resolver port to the domains that hold the answers.
//
// Monitor declares what it needs — a slug turned into the entry it names, a code token turned
// into the code it names — and the composition root is the one place allowed to know who can
// answer. That is what keeps the monitor domain free of every other domain.
//
// A slug is not an identity: it can be renamed and reparented, and an aggregate keyed on one
// splits an entry's history into two rows that cannot be summed (docs/design/monitor.md §6
// rule 1). Everything here exists to buy the immutable id behind the slug.

package main

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	monitor "github.com/atmaxmoj/standmeet/internal/monitor/facade"
	"github.com/atmaxmoj/standmeet/internal/monitor/mw"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// monitorResolver —— the Resolver implementation. Holds only read handles.
type monitorResolver struct {
	seo   owner.SEODeps
	codes *access.CodeRepo
}

var _ mw.Resolver = (*monitorResolver)(nil)

// Entity —— the entry a slug names, for one corpus genre.
//
// A miss returns the zero value and is never an error: the slug may name something just
// deleted, or a path a visitor typed. The event is then recorded against its path alone — it
// still counts as a visit, but it cannot be grouped with that entry's other reads.
//
// ponytail: one meta listing per recorded reader view, recomputing tree paths each time. That
// is the same read the landing handler already does, on a surface a personal instance serves
// dozens of times a day. Add a short TTL cache if an instance ever serves enough reader traffic
// for it to show — but a stale cache misses a just-renamed entry, which is exactly the history
// split §6 forbids, so such a cache must be invalidated on a corpus write, not merely aged.
func (m *monitorResolver) Entity(ctx context.Context, kind, slug string) monitor.Entity {
	if slug == "" {
		return monitor.Entity{}
	}
	ownerRow, ok := owner.FirstOwner(ctx, m.seo)
	if !ok {
		return monitor.Entity{}
	}
	return m.entryAtPath(ctx, kind, ownerRow.ID, slug)
}

// Code —— the access code a token names.
//
// The token itself never reaches a row: it is exchanged here and dropped. The label is
// snapshotted onto the event so a code the owner later revokes still reads as itself in the
// panel, rather than as a bare UUID.
func (m *monitorResolver) Code(ctx context.Context, token string) mw.CodeRef {
	if m.codes == nil || token == "" {
		return mw.CodeRef{}
	}
	code, err := m.codes.GetByCode(ctx, token)
	if err != nil {
		// A wrong code is the common case on the gate, and it is not an error here: the
		// submission is still recorded, just without a code attached.
		return mw.CodeRef{}
	}
	return mw.CodeRef{ID: code.ID, Label: code.Label}
}

// entryAtPath —— the per-genre lookup. Writings, microsites and assets are addressed by a stable
// slug or id of their own, so the URL already carries the identity and no lookup buys anything.
func (m *monitorResolver) entryAtPath(
	ctx context.Context, kind, ownerID, slug string,
) monitor.Entity {
	switch kind {
	case monitor.KindWiki:
		return m.wikiAtPath(ctx, ownerID, slug)
	case monitor.KindOutput:
		return m.outputAtPath(ctx, ownerID, slug)
	default:
		return monitor.Entity{ID: slug}
	}
}

func (m *monitorResolver) wikiAtPath(ctx context.Context, ownerID, path string) monitor.Entity {
	metas, err := m.seo.Wiki.ListAllMeta(ctx, ownerID)
	if err != nil {
		return monitor.Entity{}
	}
	paths := corpus.WikiMetaTreePaths(metas)
	for i := range metas {
		if paths[metas[i].ID] == path {
			return monitor.Entity{ID: metas[i].ID, Title: metas[i].Title}
		}
	}
	return monitor.Entity{}
}

func (m *monitorResolver) outputAtPath(ctx context.Context, ownerID, path string) monitor.Entity {
	metas, err := m.seo.Output.ListAllMeta(ctx, ownerID)
	if err != nil {
		return monitor.Entity{}
	}
	paths := corpus.OutputMetaTreePaths(metas)
	for i := range metas {
		if paths[metas[i].ID] == path {
			return monitor.Entity{ID: metas[i].ID, Title: metas[i].Title}
		}
	}
	return monitor.Entity{}
}
