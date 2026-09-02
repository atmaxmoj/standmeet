// path_acl.go — only compileGlob is left now: compiles a URI glob into a regex, used by
// [[role]] / [[role_snapshot]].AllowsCorpus.
//
// The old PathACL / PathPermission / AllowsPath / AllowsEntry were removed in A.3-IAM-5.
// ACL now goes uniformly through RoleSnapshot.AllowsCorpus(uri); every access_code must
// carry assumed_role_id (NOT NULL).
//
// Glob dialect: `**` recurses across `/` (`.*`), `*` does not cross `/` (`[^/]*`), `?`
// does not cross `/` (`[^/]`); other metacharacters are escaped.

package entity

import (
	"regexp"
	"strings"
	"sync"
)

// globRegexCache — pattern -> the compiled regex. ACL is the hot path for a corpus read
// (every read x every glob); it used to call regexp.MustCompile fresh every time. The glob
// set is small and stable (a role's granted globs), so compiling once and caching is enough.
var globRegexCache sync.Map // string → *regexp.Regexp

// MatchesAnyCorpusGlob —— positive-list corpus ACL rule in one place: raw://** is
// always denied; otherwise the URI must match at least one granted glob. Empty patterns
// → deny all (A.3-IAM-5). RoleSnapshot.AllowsCorpus delegates here, and the slim
// CorpusLister (#157) calls it directly with the role's granted globs — so search/read/
// list and snapshot ACL can never diverge.
// rawURIPrefix — raw never enters visitor retrieval. Both admission branches must veto it,
// so it's one constant, not a literal each writes for itself.
const rawURIPrefix = "raw://"

// MatchesAnyCorpusGlob —— positive-list corpus ACL rule in one place: raw://** is
// always denied; otherwise the URI must match at least one granted glob. Empty patterns
// → deny all (A.3-IAM-5).
func MatchesAnyCorpusGlob(patterns []string, uri string) bool {
	if strings.HasPrefix(uri, rawURIPrefix) {
		return false
	}
	for _, pattern := range patterns {
		if compileGlob(pattern).MatchString(uri) {
			return true
		}
	}
	return false
}

// compileGlob — pattern -> regex, cached (avoids recompiling on the hot path).
func compileGlob(pattern string) *regexp.Regexp {
	if cached, ok := globRegexCache.Load(pattern); ok {
		if re, isRE := cached.(*regexp.Regexp); isRE {
			return re
		}
	}
	re := buildGlobRegex(pattern)
	globRegexCache.Store(pattern, re)
	return re
}

// buildGlobRegex — converts glob -> regex. `**` crosses `/` (`.*`), `*` does not cross `/`
// (`[^/]*`), `?` does not cross `/` (`[^/]`); other metacharacters are escaped.
func buildGlobRegex(pattern string) *regexp.Regexp {
	const globstarToken = "\x00"
	escaped := regexp.QuoteMeta(pattern)
	escaped = strings.ReplaceAll(escaped, `\*\*`, globstarToken)
	escaped = strings.ReplaceAll(escaped, `\*`, "[^/]*")
	escaped = strings.ReplaceAll(escaped, `\?`, "[^/]")
	escaped = strings.ReplaceAll(escaped, globstarToken, ".*")
	return regexp.MustCompile("^" + escaped + "$")
}

// CorpusScope — one visitor session's corpus admission range: the role's granted positive
// list + what this code takes back. The two are orthogonal, not subtracted from each
// other: glob subtraction cannot remove a list entry (`subjectivity://cv` cannot be
// subtracted from `subjectivity://**`) — it can only be checked at match time.
// The json tags are a **crossing-the-boundary contract**: this scope is serialized whole
// and handed to the retrieval plugin inside the sandbox, then comes back to the host as-is.
type CorpusScope struct {
	Granted []string `json:"granted"`
	Denied  []string `json:"denied"`
	// PublishedOnly —— this identity reads exactly **what the owner has published**,
	// decided by each note's own `published` switch (the one the owner flips on
	// /admin/wiki).
	//
	// It is **not** a "public list". The builtin `public` identity (uninvited visitor +
	// BYOAI) used to carry the three globs `wiki://** output://** writing://**` — that
	// stored **a second copy** of "who can read what": an entry marked PRIVATE, this list
	// saying "everything", neither side knowing the other existed. That is exactly how
	// F-D-7 happened: a stranger with no code read 573 notes marked PRIVATE in wiki.
	//
	// So what this field stores is **one bit: go ask the entry**, not a restated scope.
	PublishedOnly bool `json:"published_only"`
}

// CorpusEntryRef — the one entry being judged: its URI, and its own publish switch.
//
// Made a value instead of an extra bool parameter: `published` is not a mode switch, it is
// **a property of this note**, belonging on the same side as URI as "the thing being
// judged". At the call site it reads as "can this scope read this entry".
type CorpusEntryRef struct {
	URI       string
	Published bool
}

// ReachesAnything — **can this identity reach the corpus at all** (used by the capability
// gate: if it can't reach anything, don't attach the retrieval tool).
//
// The verdict must ask the scope itself. The gate used to ask "is the positive list
// empty", but the public identity's scope is not a list at all — so once it switched to
// published-only, the retrieval capability turned off entirely for every no-code visitor,
// showing up as "search returns nothing no matter what". Every time a rule grows a new way
// to hold, whatever judges it has to learn about it too; putting the judgment on the rule
// itself means it never falls behind.
func (s CorpusScope) ReachesAnything() bool {
	return s.PublishedOnly || len(s.Granted) > 0
}

// AllowsCorpusEntry — the single source of truth for corpus admission (the corpus kind of
// the three ACL tiers):
//
//	readable(entry) = this identity can read it  AND  it hits none of this code's denies
//
// "Can read it" has two sources, depending on identity:
//   - **an invited identity** (an owner-specified role): matches any glob the role grants.
//   - **the public identity** (uninvited + BYOAI): `PublishedOnly` — looks at whether
//     **this note itself** is published. Private with no code stays unreadable, and only
//     the one datum on the entry decides what "private" means.
//
// `entry.Published` must be pulled from that row by the caller. It is required, not
// optional: the compiler therefore forces every read surface to answer "is this one
// published" — missing it does not silently pass, it fails to compile.
//
// **Pure subtraction**: deny can only shrink what's readable, a code cannot open what its
// role never gave — isomorphic to the deny sets for capability/skill, and consistent with
// A.4's rule of "pure AND, a code can only deny".
//
// **Order-independent**: deny and grant are computed in two separate passes, not
// first-match-wins in one interleaved list. A.2 originally deferred corpus-level
// narrowing for exactly the reason "order-sensitive, first-match-wins"; that described a
// design where deny lines are mixed into the glob list (which the owner explicitly
// rejected too). Two separate lists = set intersection, no ordering involved, so that
// concern does not apply here.
func AllowsCorpusEntry(scope CorpusScope, entry CorpusEntryRef) bool {
	if !grantsCorpusEntry(scope, entry) {
		return false
	}
	return !MatchesAnyCorpusGlob(scope.Denied, entry.URI)
}

// grantsCorpusEntry — the "positive" half of admission. The rule "raw is never readable"
// lives in MatchesAnyCorpusGlob, and the published branch routes through it too, so both
// branches go through the same veto.
func grantsCorpusEntry(scope CorpusScope, entry CorpusEntryRef) bool {
	if scope.PublishedOnly {
		return entry.Published && !strings.HasPrefix(entry.URI, rawURIPrefix)
	}
	return MatchesAnyCorpusGlob(scope.Granted, entry.URI)
}
