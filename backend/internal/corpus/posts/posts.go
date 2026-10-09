// Package posts —— short untitled updates, each with its own audience (docs/design/posts.md).
//
// Every read and write of the posts table is in this package (check-posts-one-reader). A post
// reaches a reader only through Service.List / Service.Get with that reader's Viewer: the owner
// sees everything; anyone else sees what the SQL rule post_visible admits (schema.sql) — one
// rule, used by the timeline, the visitor's corpus tools, the API-key facade and visitor MCP
// alike. An invisible post answers exactly like a missing one (ErrNotFound).
package posts

import (
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/posts/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// The three audiences. A post nobody chose an audience for is private.
const (
	VisibilityPrivate = "private"
	VisibilityPublic  = "public"
	VisibilityRoles   = "roles"
	VisibilityDefault = VisibilityPrivate
)

// Genre —— the corpus genre name a post answers to (corpus.* ops, tool paths, citations).
const Genre = "post"

// PathPrefix / URIPrefix —— how a visitor's corpus tools address a post: posts/<id> or post://<id>.
const (
	PathPrefix = "posts/"
	URIPrefix  = "post://"
)

// Retention —— how long a deleted post waits in the trash (the same 90 days as every asset).
const Retention = 90 * 24 * time.Hour

// ErrNotFound —— no such post, or one the reader may not see: the two are one answer.
var ErrNotFound = errors.New("post not found")

// Viewer —— who is reading. The owner sees every post; anyone else is their session's role
// (RoleID; "" = no role: anonymous, public tier, BYOAI).
type Viewer struct {
	RoleID string
	Owner  bool
}

// OwnerViewer —— the owner reading their own posts.
func OwnerViewer() Viewer { return Viewer{Owner: true} }

// Post —— one post as the owner sees it.
type Post struct {
	CreatedAt      time.Time
	UpdatedAt      time.Time
	DeletedAt      *time.Time
	ID             string
	Body           string
	Visibility     string
	VisibleRoleIDs []string
}

// Edited —— the post was changed after it was posted.
func (p *Post) Edited() bool { return p.UpdatedAt.After(p.CreatedAt) }

func fromRow(r *db.Post) Post {
	return Post{
		ID: pgstore.FormatUUID(r.ID), Body: r.Body, Visibility: r.Visibility,
		VisibleRoleIDs: pgstore.FormatUUIDList(r.VisibleRoleIds),
		CreatedAt:      r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time,
		DeletedAt: pgstore.OptTime(r.DeletedAt),
	}
}

func fromRows(rows []db.Post) []Post {
	out := make([]Post, 0, len(rows))
	for i := range rows {
		out = append(out, fromRow(&rows[i]))
	}
	return out
}
