// corpus_trash.go —— corpus.trash / corpus.restore: where corpus.delete puts an entry, and the way
// back (declared in corpus_write.go).

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

var corpusRestoreSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"id":{"type":"string","description":"The deleted entry's id, as corpus.trash lists it."}
	},
	"required":["id"]
}`)

func trashOps(deps *usecase.Deps) []fp.Op {
	return []fp.Op{
		{
			ID: "corpus.trash",
			Description: "List deleted corpus entries still in the trash, newest first: each " +
				"with its genre, title, when it was deleted, when it will be purged, and how " +
				"many descendants went with it. Restore one with corpus.restore.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listTrash(deps),
		},
		{
			ID: "corpus.restore", Danger: fp.DangerWrite,
			Description: "Restore a deleted corpus entry from the trash, with the descendants " +
				"deleted with it and its links, under the same ids and in the same place.",
			InputSchema: corpusRestoreSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      restoreFromTrash(deps),
		},
	}
}

type trashItemOut struct {
	ID          string `json:"id"`
	Genre       string `json:"genre"`
	Title       string `json:"title"`
	DeletedAt   string `json:"deleted_at"`
	PurgeAt     string `json:"purge_at"`
	Descendants int64  `json:"descendants"`
}

func trashItemView(it *repo.TrashItem) trashItemOut {
	return trashItemOut{
		ID: it.ID, Genre: it.Genre, Title: it.Title, Descendants: it.Descendants,
		DeletedAt: it.DeletedAt.UTC().Format(time.RFC3339),
		PurgeAt:   it.DeletedAt.Add(entity.TrashRetention).UTC().Format(time.RFC3339),
	}
}

func listTrash(deps *usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		items, err := usecase.ListTrash(ctx, deps, ownerID)
		if err != nil {
			return nil, corpusErr(err)
		}
		out := make([]trashItemOut, 0, len(items))
		for i := range items {
			out = append(out, trashItemView(&items[i]))
		}
		return json.Marshal(map[string][]trashItemOut{"items": out})
	}
}

func restoreFromTrash(deps *usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		ids, err := usecase.RestoreFromTrash(ctx, deps, ownerID, in.ID)
		if err != nil {
			return nil, restoreErr(err)
		}
		return json.Marshal(map[string][]string{"restored": ids})
	}
}

// restoreErr —— the two refusals only a restore has; the rest are the corpus's own.
func restoreErr(err error) error {
	if errors.Is(err, entity.ErrNotInTrash) {
		return fp.Coded(fp.NotFound("this entry is not in the trash"), "not_in_trash")
	}
	if parent, ok := errors.AsType[*entity.ParentTrashedError](err); ok {
		return fp.Coded(fp.Conflict(parent.Error()), "parent_in_trash")
	}
	return corpusErr(err)
}
