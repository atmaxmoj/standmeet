// Package dedup —— J.6c: cross-source deduplication.
//
// The same posting coming back from several of the owner's sources at once
// (e.g. Anthropic shows up in a JBA aggregate AND the owner also registered
// Anthropic's own Greenhouse) has happened repeatedly in real workflows. A
// fetcher only looks at external_id internally and can't dedup across ATS
// systems — Greenhouse's id "7726627003" and JBA's url
// "https://boards.greenhouse.io/affirm/jobs/7726627003" are two different
// namespaces pointing at the same posting. This package does the
// cross-source dedup layer; the usecase calls Apply once after all sources
// have fetched and their results have been appended for the round.
//
// Design follows the 3-layer scheme from the [[job-loop-2026-05]] memory:
//
//	L1: canonical URL  (lowercase scheme+host+path, strip query / trailing /)
//	L2: composite key  (normalize(company) :: normalize(title) :: bucket(location))
//	L3: semantic embedding (hook left in place, not implemented in this commit)
//
// Strategy: a single pass over input, computing both L1 + L2 for each entry;
// drop if either has already been seen. The first occurrence wins (Apply
// doesn't reorder input; the caller already fans-in by source registration
// order, so the first source wins).
//
// Not persisted — a pure function.
package dedup

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// Apply —— takes a fetched job list, returns the subset left after
// cross-source dedup. Preserves the original order. Returns input as-is
// when nil / empty. The caller is responsible for input already being
// ordered by "who should win" (source registration order — i.e. the
// ListByOwner order — is fine).
func Apply(jobs []jobsmodel.FetchedJob) []jobsmodel.FetchedJob {
	if len(jobs) == 0 {
		return jobs
	}
	seenURL := make(map[string]struct{}, len(jobs))
	seenComposite := make(map[string]struct{}, len(jobs))
	out := make([]jobsmodel.FetchedJob, 0, len(jobs))
	for i := range jobs {
		if dropDuplicate(&jobs[i], seenURL, seenComposite) {
			continue
		}
		out = append(out, jobs[i])
	}
	return out
}

// dropDuplicate —— per-entry decision: drop if L1 or L2 was already seen;
// otherwise record it in both sets. Split out to keep Apply's cognitive
// complexity ≤ 5.
func dropDuplicate(
	j *jobsmodel.FetchedJob,
	seenURL, seenComposite map[string]struct{},
) bool {
	if k := canonicalURL(j.URL); k != "" {
		if _, ok := seenURL[k]; ok {
			return true
		}
		seenURL[k] = struct{}{}
	}
	if k := compositeKey(j); k != "" {
		if _, ok := seenComposite[k]; ok {
			return true
		}
		seenComposite[k] = struct{}{}
	}
	return false
}

// canonicalURL —— scheme + host + path (lowercase, strip query / fragment /
// trailing /). Returns "" for an unparseable / empty url; upstream treats ""
// as "doesn't participate in L1 dedup".
//
// Real collision case: JBA passes through the absolute_url it scraped from
// Greenhouse, and it's byte-for-byte identical to the absolute_url the
// owner's own directly-registered Greenhouse source pulls. L1 catches
// exactly this case head-on.
// canonicalURL —— L1's key. **The query string can't just be dropped
// wholesale**: some boards put a posting's identity in the query (HN's
// `item?id=49315850`); dropping it collapses every entry in the same thread
// onto the same key `https://news.ycombinator.com/item`, so **the whole
// thread flattens into one**. This is exactly what happened in the real
// environment: one fetch pulled back 98 entries, only 1 was left on screen
// (F-E-24).
//
// So we only strip **tracking params** (utm_*, gh_src — the identity-
// irrelevant kind), sort the rest by key, and keep them. The kind of minor
// difference that can't be stripped (Greenhouse's `gh_jid`) is meant to be
// caught by L2's composite key instead — that's exactly the division of
// labor the comment at the top of this package describes.
func canonicalURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	path := strings.TrimRight(u.Path, "/")
	base := strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host) + path
	if q := identifyingQuery(u); q != "" {
		return base + "?" + q
	}
	return base
}

// trackingParams —— query params unrelated to posting identity, stripped
// when comparing keys.
var trackingParams = map[string]bool{
	"utm_source": true, "utm_medium": true, "utm_campaign": true,
	"utm_term": true, "utm_content": true,
	"gh_src": true, "source": true, "ref": true, "src": true,
}

// identifyingQuery —— the query with tracking params removed and sorted by
// key. Sorting is so `?a=1&b=2` and `?b=2&a=1` produce the same key.
func identifyingQuery(u *url.URL) string {
	q := u.Query()
	for k := range q {
		if trackingParams[strings.ToLower(k)] {
			q.Del(k)
		}
	}
	return q.Encode() // Encode already sorts by key on its own
}

// compositeKey —— normalize(company) "::" normalize(title) "::" bucket(location).
// If any of the three segments is empty, the whole thing counts as "" and
// L2 doesn't participate; otherwise all three are compared after normalizing.
//
// Trigger case: the Greenhouse entry passed through by JBA has an identical
// company / title to the owner's own Greenhouse, but the URL's trailing
// query string carries a minor gh_jid difference — L1 misses it, L2 catches
// it.
func compositeKey(j *jobsmodel.FetchedJob) string {
	co := normalizeCompany(j.Company)
	ti := normalizeTitle(j.Title)
	if co == "" || ti == "" {
		return ""
	}
	return co + "::" + ti + "::" + bucketLocation(j.Location)
}

// normalizeCompany —— lowercase + drop common legal suffix.
// "Acme Rockets, Inc." → "acme rockets"; "Beta Labs LLC" → "beta labs".
// Deliberately conservative: doesn't do anything as aggressive as expanding
// "&" → "and"; only touches clear legal-entity suffixes.
func normalizeCompany(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = companyJunkRE.ReplaceAllString(s, "")
	return collapseSpaces(s)
}

// normalizeTitle —— lowercase + strips parenthetical asides (e.g.
// "(US Remote)") + collapses whitespace + trims leading/trailing
// punctuation. Doesn't strip seniority keywords (Senior/Staff is a level,
// not noise).
func normalizeTitle(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = titleParenRE.ReplaceAllString(s, " ")
	return collapseSpaces(s)
}

// bucketLocation —— takes the first segment before a comma + lowercases
// (e.g. "San Francisco, CA" → "san francisco"; "Remote (US)" →
// "remote (us)" → should get trimmed down to "remote" by normalization).
// Returns "" for an empty location — L2 still fires (an empty location
// doesn't distinguish; same title+company counts as the same posting).
func bucketLocation(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if i := strings.Index(s, ","); i > 0 {
		s = s[:i]
	}
	// Simplified handling of "remote (us)" → "remote", so RemoteOK's and
	// JBA's different location spellings both fold into the same bucket.
	if i := strings.Index(s, "("); i > 0 {
		s = strings.TrimSpace(s[:i])
	}
	return collapseSpaces(s)
}

func collapseSpaces(s string) string {
	return collapseSpacesRE.ReplaceAllString(strings.TrimSpace(s), " ")
}

// Legal-entity suffix regex; multiple suffixes via alternation. Allows a
// leading comma / space, and an optional trailing period.
var companyJunkRE = regexp.MustCompile(
	`[,]?\s*\b(inc|incorporated|llc|ltd|limited|` +
		`co|corp|corporation|gmbh|sa|plc)\b\.?`,
)

// titleParenRE —— the entire "(...)" segment, including the parens + content.
var titleParenRE = regexp.MustCompile(`\([^)]*\)`)

// collapseSpacesRE —— collapses runs of whitespace into a single space.
var collapseSpacesRE = regexp.MustCompile(`\s+`)
