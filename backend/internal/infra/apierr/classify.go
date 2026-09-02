// Package apierr translates domain/usecase sentinel errors into HTTP envelopes.
//
// Why this is its own package: handlers in routes packages like admin/public are capped at cyclo <=
// 3, and a switch/case translating 5 errors already blows that. Moving the translation out of
// routes/ into apierr's table-driven Classify(err, cases) keeps the call site's cyclo at <= 2.
package apierr

import "errors"

// Envelope is the content of a unified error response. Field order follows fieldalignment.
type Envelope struct {
	Code    string
	Message string
	Status  int
}

// Case pairs "which sentinel error to match" with "which envelope to translate it into." Multiple
// cases are matched in order; the caller controls case order (first-match-wins).
type Case struct {
	Match    error
	Envelope Envelope
}

// fallback -- the envelope used when no case matches. The caller logs it in the handler when status
// >= 500, to avoid noise.
var fallback = Envelope{
	Status:  500,
	Code:    "server_error",
	Message: "internal error",
}

// Classify first checks for a DisplayError (an error carrying its own display info -> render it
// directly, no Case needed), then matches cases in order via errors.Is; if none match, returns the
// 500 fallback (no internal detail leaks). DisplayError takes priority: if an error explicitly
// declares itself displayable, honor that.
func Classify(err error, cases []Case) Envelope {
	var de DisplayError
	if errors.As(err, &de) {
		return Envelope{
			Status: de.HTTPStatus(), Code: de.DisplayCode(), Message: de.DisplayMessage(),
		}
	}
	for _, c := range cases {
		if errors.Is(err, c.Match) {
			return c.Envelope
		}
	}
	return fallback
}

// ErrEmptyField -- the cross-domain shared "required field is empty" sentinel. usecase/domain
// modules return it, and routes uniformly Classify it to 400. It lives in apierr (a leaf package)
// so modules don't have to depend back on usecases.
var ErrEmptyField = errors.New("required field is empty")
