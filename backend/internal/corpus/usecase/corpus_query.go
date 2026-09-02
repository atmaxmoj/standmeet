// corpus_query.go —— native corpus query (Dataview-class, over the real DB). A
// ` ```standmeet-query ` block in a note body is **resolved server-side** during
// corpus_read: it goes through the existing ACL-scoped filter (QueryNotes +
// allowsCorpusURI) and is replaced with a `- [[Title]]` list. ACL by construction —
// the query only ever returns entries the reader is allowed to see.

package usecase

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

const queryDefaultLimit = 50

// QuerySpec —— the filter conditions of one standmeet-query block.
type QuerySpec struct {
	Genre      string
	Tag        string
	ChildrenOf string
	Sort       string
	Limit      int
}

// queryResolver —— a lister that can run the native query (pgCorpusLister implements it;
// the eval mini-host doesn't -> the block is left as-is).
type queryResolver interface {
	Query(
		ctx context.Context, ownerID string, scope access.CorpusScope, spec QuerySpec,
	) ([]Meta, error)
}

var reQueryBlock = regexp.MustCompile("(?s)```standmeet-query[ \t]*\n(.*?)\n?```")

// ResolveQueryBlocks —— turns every standmeet-query block in body into its ACL-scoped
// result list (`- [[Title]]`). A parse/query failure degrades that block to empty
// (never crashes; fault-tolerant).
func ResolveQueryBlocks(
	ctx context.Context, qr queryResolver, ownerID string, scope access.CorpusScope, body string,
) string {
	return reQueryBlock.ReplaceAllStringFunc(body, func(block string) string {
		m := reQueryBlock.FindStringSubmatch(block)
		if m == nil {
			return ""
		}
		rows, err := qr.Query(ctx, ownerID, scope, parseQuerySpec(m[1]))
		if err != nil {
			return ""
		}
		return renderQueryList(rows)
	})
}

// parseQuerySpec —— YAML-ish DSL -> QuerySpec. Collected into a map first (a repeated
// key is overwritten by the later one, an unknown key is ignored), then read out.
func parseQuerySpec(dsl string) QuerySpec {
	fields := map[string]string{}
	for line := range strings.SplitSeq(dsl, "\n") {
		if k, v, ok := strings.Cut(line, ":"); ok {
			fields[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return QuerySpec{
		Genre: fields["genre"], Tag: fields["tag"], ChildrenOf: fields["children-of"],
		Sort: fields["sort"], Limit: atoiOr(fields["limit"], 0),
	}
}

func atoiOr(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

func renderQueryList(rows []Meta) string {
	lines := make([]string, 0, len(rows))
	for i := range rows {
		lines = append(lines, "- [["+rows[i].Title+"]]")
	}
	return strings.Join(lines, "\n")
}

// Query —— pgCorpusLister's implementation of queryResolver: filters corp notes by
// spec, applying ACL + children-of + sort + cap.
func (l *pgCorpusLister) Query(
	ctx context.Context, ownerID string, scope access.CorpusScope, spec QuerySpec,
) ([]Meta, error) {
	if l.queryRepo == nil {
		return []Meta{}, nil
	}
	rows, err := l.queryRepo.QueryNotes(ctx, ownerID, spec.Genre, spec.Tag)
	if err != nil {
		return nil, fmt.Errorf("query notes: %w", err)
	}
	out := make([]Meta, 0, len(rows))
	for i := range rows {
		if m, ok := queryRowToMeta(&rows[i], scope, spec.ChildrenOf); ok {
			out = append(out, m)
		}
	}
	slices.SortStableFunc(out, func(a, b Meta) int {
		return strings.Compare(a.Title, b.Title)
	})
	return capMetas(out, spec.Limit), nil
}

func queryRowToMeta(
	row *repo.QueryNoteRow, scope access.CorpusScope, childrenOf string,
) (Meta, bool) {
	if len(row.PathTitles) == 0 {
		return Meta{}, false
	}
	path := strings.Join(row.PathTitles, "/")
	if !allowsCorpusEntry(scope, row.Genre, path, row.Published) {
		return Meta{}, false
	}
	if childrenOf != "" && !isChildOf(row.PathTitles, childrenOf) {
		return Meta{}, false
	}
	return Meta{
		ID: row.ID, Path: path, Genre: row.Genre,
		Title: row.PathTitles[len(row.PathTitles)-1],
	}, true
}

func isChildOf(pathTitles []string, parent string) bool {
	return len(pathTitles) >= 2 && pathTitles[len(pathTitles)-2] == parent
}

// capMetas —— caps the result count (default and hard ceiling both queryDefaultLimit),
// guarding against an unbounded dump.
func capMetas(metas []Meta, limit int) []Meta {
	if limit <= 0 || limit > queryDefaultLimit {
		limit = queryDefaultLimit
	}
	if len(metas) > limit {
		return metas[:limit]
	}
	return metas
}
