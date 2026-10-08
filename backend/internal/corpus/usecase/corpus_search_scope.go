// corpus_search_scope.go —— a visitor's corpus scope as a Meili filter, so the search limit
// applies to what the visitor may read.
//
// Before, Search pulled the owner's top 100 and the ACL dropped rows afterwards: a code scoped
// to one subtree, in a corpus where 100+ notes elsewhere matched better, got nothing back.
//
// The filter is a SUPERSET of the exact glob ACL — every glob becomes the literal URI prefix in
// front of its first wildcard — and allowsCorpusEntry still checks each row. So a glob shape the
// translation cannot express only weakens the prefilter; it never admits a row.

package usecase

import (
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
)

// meiliScope —— the scope's filter expression ("" = no prefilter).
func meiliScope(scope access.CorpusScope) string {
	clauses := make([]string, 0, 1+len(scope.Denied))
	if c := grantClause(scope); c != "" {
		clauses = append(clauses, c)
	}
	for _, d := range scope.Denied {
		if c := denyClause(d); c != "" {
			clauses = append(clauses, c)
		}
	}
	return strings.Join(clauses, " AND ")
}

// grantClause —— what the scope reads: the published notes, or the granted subtrees.
func grantClause(scope access.CorpusScope) string {
	if scope.PublishedOnly {
		return "published = true"
	}
	prefixes, ok := grantPrefixes(scope.Granted)
	if !ok || len(prefixes) == 0 {
		return ""
	}
	return search.InFilter("uri_prefixes", prefixes)
}

// grantPrefixes —— each grant glob's literal URI prefix; ok=false when one has none (the whole
// grant then goes unfiltered — a dropped glob would hide what it grants).
func grantPrefixes(globs []string) ([]string, bool) {
	out := make([]string, 0, len(globs))
	for _, g := range globs {
		p, ok := globPrefix(g)
		if !ok {
			return []string{}, false
		}
		out = append(out, p)
	}
	return out, true
}

// globPrefix —— the URI every match of g lies under: g itself when it has no wildcard, else the
// path in front of the first wildcard, cut back to a whole segment (wiki://projects/** →
// wiki://projects, wiki://** → wiki://).
func globPrefix(g string) (string, bool) {
	i := strings.IndexAny(g, "*?")
	if i < 0 {
		return g, strings.Contains(g, "://")
	}
	lit := g[:i]
	lit = lit[:strings.LastIndex(lit, "/")+1]
	k := strings.Index(lit, "://")
	if k < 0 {
		return "", false
	}
	if len(lit) > k+3 {
		lit = strings.TrimSuffix(lit, "/")
	}
	return lit, true
}

// denyClause —— the two deny shapes the filter can state exactly: one entry (X) and a subtree
// below it (X/**, which does not cover X itself). Others are left to the row check.
func denyClause(d string) string {
	if !strings.ContainsAny(d, "*?") {
		return "NOT " + search.Eq("uri", d)
	}
	x, ok := strings.CutSuffix(d, "/**")
	if !ok || strings.ContainsAny(x, "*?") {
		return ""
	}
	return "NOT (" + search.Eq("uri_prefixes", x) + " AND " + search.Ne("uri", x) + ")"
}
