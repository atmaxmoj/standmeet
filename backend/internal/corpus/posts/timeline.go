// timeline.go —— the public timeline (GET /api/v1/posts, what <Posts /> renders) and the post.*
// event types.

package posts

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

// PublicView —— a post as a reader sees it: no audience, no role ids — a reader only ever gets
// what it may see, so who else may see it is none of its business.
type PublicView struct {
	AssetURLs map[string]string `json:"asset_urls,omitempty"`
	ID        string            `json:"id"`
	Body      string            `json:"body"`
	CreatedAt string            `json:"created_at"`
	Edited    bool              `json:"edited"`
}

// TimelinePage —— the page envelope, in this package's name (a face does not reach paging).
type TimelinePage = paging.Page[PublicView]

// TimelineArgs —— the page request (cursor, limit) as a face reads it off the query string.
type TimelineArgs = paging.Args

// ErrBadCursor —— a cursor that is not one this timeline handed out.
var ErrBadCursor = paging.ErrBadCursor

// Timeline —— one page of what this viewer may see, newest first; total counts only that.
// A malformed cursor is ErrBadCursor.
func (s *Service) Timeline(
	ctx context.Context, ownerID string, v Viewer, args TimelineArgs,
) (TimelinePage, error) {
	req, err := args.Parse()
	if err != nil {
		return paging.Page[PublicView]{}, err
	}
	page, err := s.List(ctx, ownerID, v, Filter{}, req)
	if err != nil {
		return paging.Page[PublicView]{}, err
	}
	return paging.Each(page, func(p *Post) PublicView {
		return PublicView{
			ID: p.ID, Body: p.Body, CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339Nano),
			Edited:    p.Edited(),
			AssetURLs: s.AssetURLs(ctx, p),
		}
	}), nil
}

// EventTypes —— post.created / post.updated / post.deleted. Thin, whatever the audience: data is
// {post_id, visibility}, never the body — a webhook or a notify rule sees that a post moved, not
// what it says.
func EventTypes() []events.Type {
	t := func(typ, desc string) events.Type {
		return events.Type{
			Type: typ, Description: desc, Subject: "post/<post id>", Exposure: events.Webhook,
		}
	}
	return []events.Type{
		t(EventCreated, "A post was published (data.post_id, data.visibility)."),
		t(EventUpdated,
			"A post was edited, re-audienced or restored (data.post_id, data.visibility)."),
		t(EventDeleted, "A post was deleted to the trash (data.post_id, data.visibility)."),
	}
}
