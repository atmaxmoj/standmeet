// cap_jobs_fetch.go —— the single `jobs.fetch_new` tool: its declaration,
// its args, its handler.
//
// Split out of cap_jobs.go because this tool's **receipt shape** isn't the
// same kind of thing as the other five: those are thin wrappers (register
// one source, fetch one by id, delete one), while this one has to answer
// both "what does today's board look like" and "what happened during this
// fetch" — so the args, the window resolution, and the assembly of all
// three tallies all live here. A change here has a different blast radius
// than a change to the other five.

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

func (c *jobsCapability) fetchNewBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "jobs.fetch_new",
		Description: "Poll one or all registered sources, then return the whole live job " +
			"pool for the window — not only what this call happened to add. Each row " +
			"carries cache_id, ttl_remaining_seconds, and new=true when this call " +
			"pooled it. Rows are headlines only; call jobs.show(cache_id) for the JD body. " +
			"Ask twice in a day and you get the same board back, not an empty list. " +
			"since_hours narrows the window; the pool's own TTL is 24h, so a larger " +
			"value returns the same board.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"source_id":{"type":"string",
					"description":"Optional specific source id (omit = all sources)."},
				"since_hours":{"type":"number",
					"description":"Hours back the pool reaches (default 24 = its own TTL)."}
			}
		}`),
		Handler: c.handleFetchNew,
	}
}

// fetchNewArgsWire —— `since_hours` is a pointer: **omitted** and **given
// as 0** are not the same thing. Omitted = use the default 24-hour window;
// given as 0 or negative = an empty window, which is a mistake and must be
// reported on the spot, never silently treated as "the whole pool"
// ([[empty-is-not-json-null]]).
type fetchNewArgsWire struct {
	SinceHours *float64 `json:"since_hours"`
	SourceID   string   `json:"source_id"`
}

const defaultPoolWindow = 24 * time.Hour

var errSinceHoursNotPositive = errors.New(
	"since_hours must be greater than 0 — omit it for the default 24h window",
)

// source —— empty string = unspecified, run against all sources.
func (a *fetchNewArgsWire) source() *string {
	if a.SourceID == "" {
		return nil
	}
	s := a.SourceID
	return &s
}

func (a *fetchNewArgsWire) window() (time.Duration, error) {
	if a.SinceHours == nil {
		return defaultPoolWindow, nil
	}
	if *a.SinceHours <= 0 {
		return 0, errSinceHoursNotPositive
	}
	return time.Duration(*a.SinceHours * float64(time.Hour)), nil
}

func (c *jobsCapability) handleFetchNew(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args fetchNewArgsWire
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return capreg.MCPError("invalid arguments: " + err.Error())
		}
	}
	since, serr := args.window()
	if serr != nil {
		return capreg.MCPError(serr.Error())
	}
	res, err := jobsuc.FetchNewJobs(ctx, *c.jobs, ownerID, args.source(), since)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "fetch_new")
	}
	// failures is returned alongside jobs, **not** turned into a single error:
	// one source's error token shouldn't throw away what the other six
	// sources fetched. The owner needs to know both "what came back" and
	// "which source failed, and why" at the same time.
	//
	// The `sources` tally is a third required piece: the job count alone
	// **can't tell you** whether "HN returned 1 result" means nobody's
	// hiring today or the fetch silently failed partway through (F-E-19).
	// Each source reports seen/pooled/duplicate, plus one cross-source
	// dedup count for how many got dropped — check 2 of the acceptance
	// criteria asks about exactly that last number.
	//
	// And the `jobs` field is **the whole pool for this window**, not just
	// the handful freshly fetched this call — the latter is only the
	// subset of the former carrying `new`. Without this, an owner asking
	// a second time in the same day would just get an empty array back
	// (F-E-29).
	return mcputil.MarshalResult(c.log, "jobs.fetch_new", map[string]any{
		"jobs":                 poolRowViews(res.Jobs),
		"failed_sources":       res.Failures,
		"sources":              res.Tallies,
		"cross_source_dropped": res.CrossSourceDropped,
	})
}
