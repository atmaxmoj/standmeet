// funnel.go —— an honest funnel (job-loop roadmap 3.2): how many applications ever reached each
// stage (from the outcome journal, so a rejection after an interview still counts the interview),
// and median days only once there are enough samples to mean anything.

package jobsmodel

import (
	"slices"
	"time"
)

// FunnelFloor —— below this many samples a median is not shown.
const FunnelFloor = 20

// FunnelInput —— one application, as the funnel reads it.
type FunnelInput struct {
	CreatedAt      time.Time
	OpenedAt       *time.Time
	FirstOutcomeAt *time.Time
	Outcome        string
	Reached        []string
}

// Funnel —— applications.funnel.
type Funnel struct {
	Reached         map[string]int `json:"reached"`
	MedianDays      FunnelMedians  `json:"median_days"`
	Samples         FunnelSamples  `json:"samples"`
	Total           int            `json:"total"`
	ExcludedWaiting int            `json:"excluded_waiting"`
}

// FunnelMedians —— nil below the floor.
type FunnelMedians struct {
	ToOpen         *float64 `json:"to_open"`
	ToFirstOutcome *float64 `json:"to_first_outcome"`
}

// FunnelSamples —— how many applications each median would rest on.
type FunnelSamples struct {
	ToOpen         int `json:"to_open"`
	ToFirstOutcome int `json:"to_first_outcome"`
}

// answered —— the outcomes that mean the other side answered.
var answered = []string{
	OutcomeResponded, OutcomeInterview, OutcomeOffer, OutcomeRejected, OutcomeHired,
}

// stages —— the outcomes a funnel counts one by one.
var stages = []string{
	OutcomeInterview, OutcomeOffer, OutcomeHired, OutcomeRejected, OutcomeWithdrawn,
}

// FunnelOf —— the funnel of these applications.
func FunnelOf(rows []FunnelInput) Funnel {
	out := Funnel{Total: len(rows), Reached: map[string]int{}}
	var toOpen, toOutcome []float64
	for i := range rows {
		r := &rows[i]
		countReached(out.Reached, r)
		if r.OpenedAt != nil {
			toOpen = append(toOpen, days(r.CreatedAt, *r.OpenedAt))
		}
		if r.FirstOutcomeAt == nil {
			out.ExcludedWaiting++
			continue
		}
		toOutcome = append(toOutcome, days(r.CreatedAt, *r.FirstOutcomeAt))
	}
	out.Samples = FunnelSamples{ToOpen: len(toOpen), ToFirstOutcome: len(toOutcome)}
	out.MedianDays = FunnelMedians{ToOpen: median(toOpen), ToFirstOutcome: median(toOutcome)}
	return out
}

func countReached(reached map[string]int, r *FunnelInput) {
	seen := append(slices.Clone(r.Reached), r.Outcome)
	if r.OpenedAt != nil {
		reached["opened"]++
	}
	if slices.ContainsFunc(seen, func(s string) bool { return slices.Contains(answered, s) }) {
		reached[OutcomeResponded]++
	}
	for _, s := range stages {
		if slices.Contains(seen, s) {
			reached[s]++
		}
	}
}

func days(from, to time.Time) float64 { return to.Sub(from).Hours() / 24 }

// median —— nil below the floor.
func median(xs []float64) *float64 {
	if len(xs) < FunnelFloor {
		return nil
	}
	s := slices.Clone(xs)
	slices.Sort(s)
	m := s[len(s)/2]
	if len(s)%2 == 0 {
		m = (s[len(s)/2-1] + s[len(s)/2]) / 2
	}
	return &m
}
