// posts_trash.go —— deleted posts in corpus.trash / corpus.restore, beside deleted notes.

package ops

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/corpus/posts"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func (p postOps) withTrashed(note fp.Invoke) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		out, err := note(ctx, ownerID, raw)
		if err != nil {
			return nil, err
		}
		var page struct {
			Items []trashItemOut `json:"items"`
		}
		if uerr := json.Unmarshal(out, &page); uerr != nil {
			return nil, fp.OpErr("corpus trash", fmt.Errorf("decode: %w", uerr))
		}
		trashed, err := p.trashed(ctx, ownerID)
		if err != nil {
			return nil, err
		}
		page.Items = append(page.Items, trashed...)
		slices.SortStableFunc(page.Items, func(a, b trashItemOut) int {
			return cmp.Compare(b.DeletedAt, a.DeletedAt)
		})
		return json.Marshal(page)
	}
}

// trashed —— the deleted posts as trash rows. A post has no title, so its opening words stand in.
func (p postOps) trashed(ctx context.Context, ownerID string) ([]trashItemOut, error) {
	list, err := p.s.Trashed(ctx, ownerID)
	if err != nil {
		return nil, postErr(err)
	}
	out := make([]trashItemOut, 0, len(list))
	for i := range list {
		deleted := *list[i].DeletedAt
		out = append(out, trashItemOut{
			ID: list[i].ID, Genre: posts.Genre, Title: posts.Excerpt(list[i].Body),
			DeletedAt: rfc3339(deleted), PurgeAt: rfc3339(deleted.Add(posts.Retention)),
		})
	}
	return out, nil
}

func (p postOps) restoreFirst(note fp.Invoke) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in postIDArgs
		if json.Unmarshal(raw, &in) != nil || in.ID == "" {
			return note(ctx, ownerID, raw)
		}
		found, err := p.s.Restore(ctx, ownerID, in.ID)
		if err != nil {
			return nil, postErr(err)
		}
		if !found {
			return note(ctx, ownerID, raw)
		}
		return json.Marshal(map[string][]string{"restored": {in.ID}})
	}
}
