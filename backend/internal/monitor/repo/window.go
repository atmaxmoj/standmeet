// window.go —— the three spans the panel offers, and what a window name means.
//
// One file decides. The summary, the feed beside it and the retention job must all agree on what
// "90d" means — three facts that drift the moment each is spelled where it is used.

package repo

import (
	"encoding/json"
	"fmt"
	"time"
)

// The windows the panel offers, and the only ones a caller may name.
//
// Three, not a free date range. A traffic panel is read to answer "is this going anywhere",
// and that question has three useful resolutions: the last week, the last month, the last
// quarter. An arbitrary range is a different tool — one for investigating a specific day —
// and offering it before anyone has asked buys a date picker instead of an answer.
const (
	Window7d  = "7d"
	Window28d = "28d"
	Window90d = "90d"
	// DefaultWindow —— what an owner sees on opening the panel. 28 days: a week is too short
	// to show a trend on a personal site, a quarter too coarse to notice this week.
	DefaultWindow = Window28d
)

const (
	windowSpan7d  = 7 * 24 * time.Hour
	windowSpan28d = 28 * 24 * time.Hour
	windowSpan90d = 90 * 24 * time.Hour
)

// windowSpans —— the only map from a name to a duration. A name outside it is not an error:
// it falls back to the default, because a stale bookmark carrying an old window name should
// show the owner their traffic, not an error page.
var windowSpans = map[string]time.Duration{
	Window7d:  windowSpan7d,
	Window28d: windowSpan28d,
	Window90d: windowSpan90d,
}

// WindowSince —— the cutoff a window name means, relative to now.
func WindowSince(window string, now time.Time) time.Time {
	span, ok := windowSpans[window]
	if !ok {
		span = windowSpans[DefaultWindow]
	}
	return now.Add(-span)
}

// StatsInputSchema —— the summary takes the same window as the feed, so the five numbers and
// the rows beside them are always counted over the same span.
var StatsInputSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"window":{"type":"string","enum":["7d","28d","90d"],
			"description":"How far back to count. Default 28d."}
	}
}`)

// StatsArgs —— what the summary read accepts.
type StatsArgs struct {
	Window string `json:"window"`
}

// StatsSince —— the summary's cutoff. Same decoder as the feed's, so a window name means the
// same span on both sides of the panel.
func StatsSince(raw json.RawMessage) (time.Time, error) {
	var in StatsArgs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return time.Time{}, fmt.Errorf("invalid arguments: %w", err)
		}
	}
	return WindowSince(in.Window, time.Now().UTC()), nil
}
