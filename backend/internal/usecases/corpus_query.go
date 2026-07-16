// corpus_query.go —— 原生语料查询(Dataview-class,over 真 DB)。note body 里的 ` ```standmeet-query `
// 块在 corpus_read 时**服务端解析**:走现成 ACL-scoped 过滤(QueryNotes + allowsCorpusURI),替换成
// `- [[Title]]` 列表。ACL by construction —— 查询只返 reader 有权看的条目。

package usecases

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const queryDefaultLimit = 50

// QuerySpec —— 一个 standmeet-query 块的过滤条件。
type QuerySpec struct {
	Genre      string
	Tag        string
	ChildrenOf string
	Sort       string
	Limit      int
}

// queryResolver —— 能跑原生查询的 lister(pgCorpusLister 实现;eval mini-host 不实现 → 块留原样)。
type queryResolver interface {
	Query(
		ctx context.Context, ownerID string, grantedGlobs []string, spec QuerySpec,
	) ([]CorpusMeta, error)
}

var reQueryBlock = regexp.MustCompile("(?s)```standmeet-query[ \t]*\n(.*?)\n?```")

// ResolveQueryBlocks —— body 里每个 standmeet-query 块 → ACL-scoped 结果列表(`- [[Title]]`)。
// 解析/查询失败 → 该块降级为空(不崩;容错)。
func ResolveQueryBlocks(
	ctx context.Context, qr queryResolver, ownerID string, grantedGlobs []string, body string,
) string {
	return reQueryBlock.ReplaceAllStringFunc(body, func(block string) string {
		m := reQueryBlock.FindStringSubmatch(block)
		if m == nil {
			return ""
		}
		rows, err := qr.Query(ctx, ownerID, grantedGlobs, parseQuerySpec(m[1]))
		if err != nil {
			return ""
		}
		return renderQueryList(rows)
	})
}

// parseQuerySpec —— YAML-ish DSL → QuerySpec。收进 map(重复键后者覆盖、未知键忽略)再取。
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

func renderQueryList(rows []CorpusMeta) string {
	lines := make([]string, 0, len(rows))
	for i := range rows {
		lines = append(lines, "- [["+rows[i].Title+"]]")
	}
	return strings.Join(lines, "\n")
}

// Query —— pgCorpusLister 实现 queryResolver:按 spec 过滤 corp note,ACL + children-of + sort + cap。
func (l *pgCorpusLister) Query(
	ctx context.Context, ownerID string, grantedGlobs []string, spec QuerySpec,
) ([]CorpusMeta, error) {
	if l.queryRepo == nil {
		return []CorpusMeta{}, nil
	}
	rows, err := l.queryRepo.QueryNotes(ctx, ownerID, spec.Genre, spec.Tag)
	if err != nil {
		return nil, fmt.Errorf("query notes: %w", err)
	}
	out := make([]CorpusMeta, 0, len(rows))
	for i := range rows {
		if m, ok := queryRowToMeta(&rows[i], grantedGlobs, spec.ChildrenOf); ok {
			out = append(out, m)
		}
	}
	slices.SortStableFunc(out, func(a, b CorpusMeta) int {
		return strings.Compare(a.Title, b.Title)
	})
	return capMetas(out, spec.Limit), nil
}

func queryRowToMeta(
	row *postgres.QueryNoteRow, grantedGlobs []string, childrenOf string,
) (CorpusMeta, bool) {
	if len(row.PathTitles) == 0 {
		return CorpusMeta{}, false
	}
	path := strings.Join(row.PathTitles, "/")
	if !allowsNote(grantedGlobs, noteACL{genre: row.Genre, path: path, ownerOnly: row.OwnerOnly}) {
		return CorpusMeta{}, false
	}
	if childrenOf != "" && !isChildOf(row.PathTitles, childrenOf) {
		return CorpusMeta{}, false
	}
	return CorpusMeta{
		ID: row.ID, Path: path, Genre: row.Genre,
		Title: row.PathTitles[len(row.PathTitles)-1],
	}, true
}

func isChildOf(pathTitles []string, parent string) bool {
	return len(pathTitles) >= 2 && pathTitles[len(pathTitles)-2] == parent
}

// capMetas —— 结果上限(默认 + 硬顶 queryDefaultLimit),防无界 dump。
func capMetas(metas []CorpusMeta, limit int) []CorpusMeta {
	if limit <= 0 || limit > queryDefaultLimit {
		limit = queryDefaultLimit
	}
	if len(metas) > limit {
		return metas[:limit]
	}
	return metas
}
