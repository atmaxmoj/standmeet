// outcome.go —— what came of an application (roadmap E1, 1.3), set by the owner. Separate from the
// submission status (how the sending went): withdrawing is the owner's decision, not a result of
// sending.

package jobsmodel

import (
	"errors"
	"slices"
	"time"
)

// The outcomes, in the order an application usually moves through them.
const (
	OutcomeNone      = "none"
	OutcomeResponded = "responded"
	OutcomeInterview = "interview"
	OutcomeOffer     = "offer"
	OutcomeRejected  = "rejected"
	OutcomeHired     = "hired"
	OutcomeWithdrawn = "withdrawn"
)

// Outcomes —— every outcome an application can have.
var Outcomes = []string{
	OutcomeNone, OutcomeResponded, OutcomeInterview, OutcomeOffer, OutcomeRejected, OutcomeHired,
	OutcomeWithdrawn,
}

// ErrUnknownOutcome —— a name that is not one of Outcomes.
var ErrUnknownOutcome = errors.New("unknown outcome")

// IsOutcome —— one of Outcomes.
func IsOutcome(s string) bool { return slices.Contains(Outcomes, s) }

// OutcomeEntry —— one change of an application's outcome: a line of its timeline.
type OutcomeEntry struct {
	CreatedAt time.Time
	From      string
	To        string
	Note      string
}
