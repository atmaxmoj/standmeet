// followup.go —— when an application is next due a follow-up (job-loop roadmap 3.1), from recorded
// facts only: the commit time, the outcome, whether it was opened, the nudges so far.

package jobsmodel

import "time"

// FollowupNudgeLimit —— after this many nudges with no answer, an application is cold.
const FollowupNudgeLimit = 2

// Follow-up states on an application row.
const (
	FollowupDue  = "due"
	FollowupCold = "cold"
)

const day = 24 * time.Hour

// afterOutcome —— the wait a new outcome sets; afterNudge —— the wait after each nudge. An outcome
// missing from a table has no follow-up (offer, hired, rejected, withdrawn).
var (
	afterOutcome = map[string]time.Duration{
		OutcomeNone: 7 * day, OutcomeResponded: 3 * day, OutcomeInterview: 1 * day,
	}
	afterNudge = map[string]time.Duration{
		OutcomeNone: 7 * day, OutcomeResponded: 7 * day, OutcomeInterview: 30 * day,
	}
)

// FollowupAfterOutcome —— the next follow-up once the outcome is set; nil = none.
func FollowupAfterOutcome(outcome string, now time.Time) *time.Time {
	return after(afterOutcome, outcome, now)
}

// FollowupAfterNudge —— the next follow-up once a nudge was announced; nil = none.
func FollowupAfterNudge(outcome string, now time.Time) *time.Time {
	return after(afterNudge, outcome, now)
}

func after(waits map[string]time.Duration, outcome string, now time.Time) *time.Time {
	wait, ok := waits[outcome]
	if !ok {
		return nil
	}
	t := now.Add(wait)
	return &t
}

// FollowupState —— due, cold, or "" (nothing to do). Opened with no outcome is never due: the
// owner answers what they asked instead of nudging blind.
func FollowupState(a *Application, now time.Time) string {
	switch {
	case a.Outcome == OutcomeNone && a.FollowupNudges >= FollowupNudgeLimit:
		return FollowupCold
	case dueAt(a, now):
		return FollowupDue
	}
	return ""
}

func dueAt(a *Application, now time.Time) bool {
	if a.NextFollowupAt == nil || a.NextFollowupAt.After(now) {
		return false
	}
	return a.FollowupNudges < FollowupNudgeLimit && !blind(a)
}

// blind —— opened, and no outcome yet: a nudge now would ignore what they already asked.
func blind(a *Application) bool { return a.Outcome == OutcomeNone && a.OpenedAt != nil }
