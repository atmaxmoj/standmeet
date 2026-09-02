package apierr

// DisplayError -- an error whose message can be echoed straight to the end user. Business/usecase
// layers return it; HTTP infra (Classify -> writeError) claims it and renders it into the envelope
// as-is. Errors that don't implement it always fall back to 500, so no internal detail leaks. In
// other words, whether an error is safe to show the user travels with the error itself, instead of
// every handler maintaining its own sentinel->envelope Case table.
//
// Structural satisfaction: any package's error type is a DisplayError as long as it has these three
// methods, no need to import apierr (avoids a dependency inversion). Wrapping is honored too: after
// fmt.Errorf("...: %w", de), errors.As can still pull out the underlying DisplayError.
type DisplayError interface {
	error
	HTTPStatus() int
	DisplayCode() string
	DisplayMessage() string
}

// displayError -- the standard implementation of DisplayError. When cause is non-nil, Error() (goes
// to the log) includes the underlying cause, but DisplayMessage() (sent to the client) gives only
// the human-readable text -- the type itself guarantees the split between "log the raw cause, send
// the friendly message". Field order follows fieldalignment.
type displayError struct {
	cause   error
	code    string
	message string
	status  int
}

func (e *displayError) Error() string {
	if e.cause != nil {
		return e.message + ": " + e.cause.Error()
	}
	return e.message
}
func (e *displayError) Unwrap() error          { return e.cause }
func (e *displayError) HTTPStatus() int        { return e.status }
func (e *displayError) DisplayCode() string    { return e.code }
func (e *displayError) DisplayMessage() string { return e.message }

// Display -- builds a displayable error: HTTP status + machine code (for frontend branching) + a
// user-facing message (human language, no stack trace or jargon).
func Display(status int, code, message string) error {
	return &displayError{status: status, code: code, message: message}
}

// DisplayWrap -- same as Display, but wraps an underlying cause: the cause goes to the log
// (retrievable via Error/Unwrap), the client still only sees message. Deep functions (e.g. provider
// network errors) use this: a single return satisfies both "ops can see the raw cause" and "the
// user only sees the friendly text".
func DisplayWrap(status int, code, message string, cause error) error {
	return &displayError{status: status, code: code, message: message, cause: cause}
}
