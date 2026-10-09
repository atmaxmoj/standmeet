// posts.go —— posts on the owner's corpus.* verbs (genre "post", docs/design/posts.md): the same
// verbs every genre has, routed to the posts service by WithPosts before the note genres see
// them. corpus.trash lists deleted posts beside deleted notes; corpus.restore tries the posts
// trash first.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/posts"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

// postOut —— a post on the owner's surfaces (MCP, admin).
type postOut struct {
	AssetURLs      map[string]string `json:"asset_urls,omitempty"`
	Genre          string            `json:"genre"`
	ID             string            `json:"id"`
	Body           string            `json:"body"`
	Visibility     string            `json:"visibility"`
	CreatedAt      string            `json:"created_at"`
	UpdatedAt      string            `json:"updated_at"`
	VisibleRoleIDs []string          `json:"visible_role_ids"`
	Edited         bool              `json:"edited"`
}

func postView(ctx context.Context, s *posts.Service, p *posts.Post) postOut {
	return postOut{
		Genre: posts.Genre, ID: p.ID, Body: p.Body, Visibility: p.Visibility,
		VisibleRoleIDs: nonNilStrings(p.VisibleRoleIDs), Edited: p.Edited(),
		CreatedAt: rfc3339Nano(p.CreatedAt), UpdatedAt: rfc3339Nano(p.UpdatedAt),
		AssetURLs: s.AssetURLs(ctx, p),
	}
}

// WithPosts —— the corpus ops, with genre "post" routed to the posts service (nil = unchanged).
func WithPosts(ops []fp.Op, s *posts.Service) []fp.Op {
	if s == nil {
		return ops
	}
	p := postOps{s: s}
	wrap := map[string]func(fp.Invoke) fp.Invoke{
		"corpus.list":    byGenre(p.list),
		"corpus.get":     byGenre(p.get),
		"corpus.search":  byGenre(p.search),
		"corpus.create":  byGenre(p.create),
		"corpus.update":  byGenre(p.update),
		"corpus.delete":  byGenre(p.del),
		"corpus.trash":   p.withTrashed,
		"corpus.restore": p.restoreFirst,
	}
	out := slices.Clone(ops)
	for i := range out {
		if w, ok := wrap[out[i].ID]; ok {
			out[i].Invoke = w(out[i].Invoke)
		}
	}
	return out
}

// byGenre —— genre "post" goes to post, every other genre to the op it wraps.
func byGenre(post fp.Invoke) func(fp.Invoke) fp.Invoke {
	return func(note fp.Invoke) fp.Invoke {
		return func(
			ctx context.Context, ownerID string, raw json.RawMessage,
		) (json.RawMessage, error) {
			var g struct {
				Genre string `json:"genre"`
			}
			if json.Unmarshal(raw, &g) == nil && g.Genre == posts.Genre {
				return post(ctx, ownerID, raw)
			}
			return note(ctx, ownerID, raw)
		}
	}
}

type postOps struct{ s *posts.Service }

type postListArgs struct {
	Visibility string `json:"visibility"`
	Q          string `json:"q"`
}

func (p postOps) page(
	ctx context.Context, ownerID string, f posts.Filter, req paging.Request,
) (json.RawMessage, error) {
	page, err := p.s.List(ctx, ownerID, posts.OwnerViewer(), f, req)
	if err != nil {
		return nil, postErr(err)
	}
	view := func(x *posts.Post) postOut { return postView(ctx, p.s, x) }
	return json.Marshal(paging.Each(page, view))
}

func (p postOps) list(
	ctx context.Context, ownerID string, raw json.RawMessage,
) (json.RawMessage, error) {
	in, err := paging.ParseArgs[postListArgs](raw)
	if err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	return p.page(ctx, ownerID, posts.Filter(in.Filter), in.Req)
}

func (p postOps) search(
	ctx context.Context, ownerID string, raw json.RawMessage,
) (json.RawMessage, error) {
	var in struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"query", in.Query}); err != nil {
		return nil, err
	}
	return p.page(ctx, ownerID, posts.Filter{Q: in.Query}, paging.Request{Limit: paging.MaxLimit})
}

type postIDArgs struct {
	ID string `json:"id"`
}

func decodePostID(raw json.RawMessage) (string, error) {
	var in postIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.ID, fp.RequireArgs([2]string{"id", in.ID})
}

func (p postOps) get(
	ctx context.Context, ownerID string, raw json.RawMessage,
) (json.RawMessage, error) {
	id, err := decodePostID(raw)
	if err != nil {
		return nil, err
	}
	post, err := p.s.Get(ctx, ownerID, posts.OwnerViewer(), id)
	if err != nil {
		return nil, postErr(err)
	}
	return json.Marshal(postView(ctx, p.s, &post))
}

// postWriteArgs —— create / update. A pointer is "omitted"; created_at is refused (it is the post
// time, never an edit).
type postWriteArgs struct {
	Body           *string   `json:"body"`
	Visibility     *string   `json:"visibility"`
	VisibleRoleIDs *[]string `json:"visible_role_ids"`
	CreatedAt      *string   `json:"created_at"`
	ID             string    `json:"id"`
}

func decodePostWrite(raw json.RawMessage) (postWriteArgs, error) {
	var in postWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if in.CreatedAt != nil {
		return in, fp.BadInput("created_at is the post time and cannot be set")
	}
	return in, nil
}

func (in *postWriteArgs) patch() *posts.Patch {
	return &posts.Patch{Body: in.Body, Visibility: in.Visibility, VisibleRoleIDs: in.VisibleRoleIDs}
}

func (p postOps) create(
	ctx context.Context, ownerID string, raw json.RawMessage,
) (json.RawMessage, error) {
	in, err := decodePostWrite(raw)
	if err != nil {
		return nil, err
	}
	post, err := p.s.Create(ctx, ownerID, in.patch())
	if err != nil {
		return nil, postErr(err)
	}
	return json.Marshal(postView(ctx, p.s, &post))
}

func (p postOps) update(
	ctx context.Context, ownerID string, raw json.RawMessage,
) (json.RawMessage, error) {
	in, err := decodePostWrite(raw)
	if err != nil {
		return nil, err
	}
	if rerr := fp.RequireArgs([2]string{"id", in.ID}); rerr != nil {
		return nil, rerr
	}
	post, err := p.s.Update(ctx, ownerID, in.ID, in.patch())
	if err != nil {
		return nil, postErr(err)
	}
	return json.Marshal(postView(ctx, p.s, &post))
}

func (p postOps) del(
	ctx context.Context, ownerID string, raw json.RawMessage,
) (json.RawMessage, error) {
	id, err := decodePostID(raw)
	if err != nil {
		return nil, err
	}
	if terr := p.s.Trash(ctx, ownerID, id); terr != nil {
		return nil, postErr(terr)
	}
	return json.Marshal(deletedOut{Genre: posts.Genre, ID: id, Deleted: true})
}

// postErr —— a post's refusals in the protocol's words.
func postErr(err error) error {
	if errors.Is(err, posts.ErrNotFound) {
		return fp.Coded(fp.NotFound("post not found"), "post_not_found")
	}
	if in, ok := errors.AsType[*posts.InputError](err); ok {
		return fp.BadInput(in.Msg)
	}
	return corpusErr(err)
}

func rfc3339Nano(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
