// fetch_result.go — the **shape** one `jobs.fetch_new` call hands back: what was fetched,
// which sources failed, and each source's tally for this run. Kept separate from jobs.go's
// flow because these are the **receipt's contract** — this is what the owner's AI actually
// reads, and its blast radius is a different thing from changing the flow.
//
// (The direct reason for the split file is that jobs.go grew past the 350-line gate. The
// gate was right this time: "what one fetch's result looks like" and "how the fetch runs"
// were always two different things.)

package jobsuc

import (
	"errors"
	"time"

	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// FetchResult — the complete result of one fetch: **what was retrieved** + **which
// sources failed**.
//
// Collected into one named struct rather than an extra return value: one fetch is
// inherently a "partial success" kind of thing, and putting both halves together means a
// caller can't catch only one of them. (A third return value would also be blocked by
// revive's function-result-limit — this time the gate pushed the code toward a better
// shape, not a worse one.)
type FetchResult struct {
	// Jobs — **every job currently in the pool's window**, not just the handful newly
	// pulled in this run.
	//
	// This used to hold only "newly pooled this run", so an owner asking "what's new
	// today" a second time in the same day got back an empty array — while the pool was
	// sitting on 200+ live jobs, visible on the GUI's /admin/listings (`Pool.ListByOwner`)
	// but unreachable by the owner's own AI (F-E-29). Ranking is Claude's job by design,
	// but it has to be able to see what it's ranking first.
	//
	// Each row carries its own `New`, so "what's out there today" and "what just showed
	// up" are two questions answered by the same list.
	Jobs     []PoolRow
	Failures []SourceFailure
	// Tallies — each source's accounting for this run. **Without it, a fetch's result
	// can't be interpreted**: "HN returned 1 posting" could mean nobody's hiring today,
	// could mean we got rate-limited, or could mean a filter condition is wrong — all
	// three produce an identical receipt otherwise (F-E-19). Counted out, it needs no
	// inference — and the first live fetch after this went in pinned down F-E-24's
	// location using exactly these three numbers (98 in, 1 out, 97 dropped).
	Tallies []SourceTally
	// CrossSourceDropped — how many entries cross-source dedup blocked. This is exactly
	// what acceptance check 2 asks about (the same posting from two sources should
	// collapse to one row), and it used to only be inferable from arithmetic like "the
	// pool total is smaller than the sum of the two sources" — an inferred conclusion
	// doesn't count as verified.
	CrossSourceDropped int
}

// PoolRow — one row handed to the owner's own AI: one job in the pool, how much longer it
// has left to live, and whether it's **newly appeared** this run.
//
// `New` is never inferred from "remaining TTL is close to 24h" — that's inference, not
// data ([[no-diagnosis-by-experiment]]).
type PoolRow struct {
	Job          jobsmodel.FetchedJob
	TTLRemaining time.Duration
	New          bool
}

// SourceTally — one source's accounting for this run: how many the upstream offered, how
// many actually made it into the pool, how many per-source dedup blocked.
//
// `Seen` is the count the adapter hands back (what it skips internally is counted
// separately, see each adapter); `Pooled` is what's newly written into the pool this run;
// `Duplicate` = already seen before. Only together do the three numbers answer what
// actually happened in this fetch.
type SourceTally struct {
	// Skipped — counts the adapter skipped internally, broken down **by reason**
	// (only sources that fetch item-by-item have this). "Fetch failed" and "this one was
	// deleted" must stay distinguishable: collapsing them into one number is the same as
	// not counting at all (F-E-19).
	Skipped   map[string]int `json:"skipped,omitempty"`
	SourceID  string         `json:"source_id"`
	Label     string         `json:"label"`
	Kind      string         `json:"kind"`
	Seen      int            `json:"seen"`
	Pooled    int            `json:"pooled"`
	Duplicate int            `json:"duplicate"`
	// Available / Read — how many the upstream says exist in total, vs how many we
	// actually paged through. The two numbers disagreeing means **truncation** —
	// and truncation looks identical to "that's just how many the upstream has" on `Seen`.
	Available int  `json:"available,omitempty"`
	Read      int  `json:"read,omitempty"`
	Truncated bool `json:"truncated,omitempty"`
}

// SourceFailure — one source failed to fetch, the rest ran normally. Carries what the
// owner can recognize (label / kind), because what the owner sees on /admin/sources is the
// label, not the uuid.
type SourceFailure struct {
	SourceID string `json:"source_id"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	Reason   string `json:"reason"`
}

// sourceRun — the two things one source's run produces: the rows going into the pool, and
// this run's tally.
// Collected into one struct rather than an extra return value, same reasoning as
// FetchResult: both halves must be caught together.
type sourceRun struct {
	jobs  []jobsmodel.FetchedJob
	tally SourceTally
}

// sourceFailureSentence — the **human-facing** sentence stored on the source's row.
//
// Different job from `SourceFailure.Reason`: that one is the full error chain the owner's
// AI reads (source id, internal verb, URL are all useful there — F-E-6 exists precisely so
// those details stop getting swallowed); this line on `/admin/sources` is for **a person**
// to read — laying out the whole chain there would wrap across three lines, with the first
// two segments still being a uuid and an internal verb (UX-77).
//
// Same wording discipline as mailFailureReason / calendarFailureReason: **every sentence
// points at a next step**, none carry status codes, hostnames, or stack traces.
func sourceFailureSentence(err error) string {
	for _, c := range failureSentences {
		if errors.Is(err, c.kind) {
			return c.say
		}
	}
	// Covers anything not yet classified: to the owner it's all the same thing — they
	// can't fix it, try again later.
	return "couldn't reach the board — try again later"
}

// failureSentences — the classification table. **Order is priority**: first match wins.
var failureSentences = []struct {
	kind error
	say  string
}{
	{jobfetch.ErrUpstreamAuth, "this source's credential was rejected — replace the token"},
	{jobfetch.ErrUpstreamSchema, "the board's answer wasn't the shape this source sends"},
	{jobsmodel.ErrJobSourceConfigInvalid, "this source's settings are incomplete — re-register"},
	// These three must come **before** ErrUpstream: they all wrap it, and order is
	// priority — placed after it, they'd never get a turn (the mirror image of
	// [[red-that-cannot-go-green]]: a sentence that can never come out).
	{jobfetch.ErrUpstreamNoBoard, "no such board at that address — check this source's settings"},
	{jobfetch.ErrUpstreamMoved, "the board has moved — re-register it with the new address"},
	{jobfetch.ErrUpstreamBusy, "the board asked us to slow down — it'll be retried later"},
	// The fallback sentence has to change wording too: relocation now has its own
	// category, so what's left falling through here is 5xx, connection failures, and
	// other 4xx — telling those "it may have moved" would be just as false. What this
	// class has in common is **the owner can't do anything about it**, so the sentence
	// only says that.
	{jobfetch.ErrUpstream, "the board didn't answer — nothing to change here, it'll be retried"},
}

// failureOf — turns one source's failure into a line the owner can act on.
// The backend log already has the source id, kind, URL, and reason; the owner's side used
// to only get "jobs.fetch_new failed". The two sides differ by a whole error chain's worth
// of information, and the only person who can fix that is the owner.
func failureOf(src *jobsmodel.JobSource, err error) SourceFailure {
	return SourceFailure{
		SourceID: src.ID,
		Label:    src.Label,
		Kind:     src.Kind,
		Reason:   err.Error(),
	}
}
