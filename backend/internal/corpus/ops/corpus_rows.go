// corpus_rows.go —— 三个 genre 的行 → 那一份统一形状(声明在 corpus.go)。
//
// 地址(path)是**树派生**的:列表一次算全窗口的路径表,详情单条算。owner 不能自设地址,
// 所以这儿没有"path 字段",只有算出来的那个。

package ops

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

// rawStatus —— 侧栏那个"待收拾"角标数的就是它:promote 过就算处理完了。
func rawStatus(r *entity.Raw) string {
	if r.IsPromoted() {
		return "promoted"
	}
	return "unprocessed"
}

func rawItem(r *entity.Raw, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreRaw, ID: r.ID(), Body: r.Body(),
		Preview: usecase.LeadLine(r.Body(), previewMaxLen),
		Source:  r.Source(), Status: rawStatus(r),
		Tags: nonNilStrings(r.Tags()), SourceRawIDs: []string{},
		SourceWikiIDs: []string{},
		CreatedAt:     rfc3339(r.CreatedAt()), UpdatedAt: rfc3339(r.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := r.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

func wikiItem(w *entity.Wiki, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreWiki, ID: w.ID(), Title: w.Title(),
		Preview: usecase.LeadLine(w.Body(), previewMaxLen), Excerpt: w.Excerpt(),
		Tags: nonNilStrings(w.Tags()), SourceRawIDs: nonNilStrings(w.SourceRawIDs()),
		SourceWikiIDs: []string{},
		ShowAsSource:  w.ShowAsSource(), Published: w.Published(),
		CreatedAt: rfc3339(w.CreatedAt()), UpdatedAt: rfc3339(w.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := w.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

func outputItem(o *entity.Output, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreOutput, ID: o.ID(), Title: o.Title(),
		Preview: usecase.LeadLine(o.Body(), previewMaxLen), Excerpt: o.Excerpt(),
		Tags: nonNilStrings(o.Tags()), SourceRawIDs: []string{},
		SourceWikiIDs: nonNilStrings(o.SourceWikiIDs()),
		ShowAsSource:  o.ShowAsSource(), Published: o.Published(),
		CreatedAt: rfc3339(o.CreatedAt()), UpdatedAt: rfc3339(o.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := o.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

func pathOrNil(p string) *string {
	if p == "" {
		return nil
	}
	return &p
}

func listRawItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Raw.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list raw: %w", err)
	}
	paths := usecase.RawTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, rawItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func listWikiItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Wiki.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	paths := usecase.WikiTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, wikiItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func listOutputItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Output.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list output: %w", err)
	}
	paths := usecase.OutputTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, outputItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func getRawItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Raw.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get raw: %w", err)
	}
	return rawItem(&row, ""), nil
}

func getWikiItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Wiki.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get wiki: %w", err)
	}
	item := wikiItem(&row, entryPath(ctx, deps, genreWiki, ownerID, id))
	item.Body = row.Body()
	return item, nil
}

func getOutputItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Output.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get output: %w", err)
	}
	item := outputItem(&row, entryPath(ctx, deps, genreOutput, ownerID, id))
	item.Body = row.Body()
	return item, nil
}

// entryPath —— 单条的树派生地址。算不出就空:地址是展示用的一半,不该让详情打不开。
func entryPath(ctx context.Context, deps usecase.Deps, genre, ownerID, id string) string {
	var (
		path string
		err  error
	)
	switch genre {
	case genreWiki:
		path, err = usecase.WikiEntryPath(ctx, deps.Wiki, ownerID, id)
	case genreOutput:
		path, err = usecase.OutputEntryPath(ctx, deps.Output, ownerID, id)
	default:
		return ""
	}
	if err != nil {
		return ""
	}
	return path
}
