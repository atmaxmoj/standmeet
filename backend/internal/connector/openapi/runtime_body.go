// runtime_body.go — the request-body segment: JSONata evaluation → required-field pre-flight
// → **encoding by the media type the spec declares**.
//
// Split out of runtime.go (that file hit the 350-line gate). The split is a whole family,
// not an arbitrary cut: "what this request's body looks like and how it's encoded" is one
// topic; URL, auth, response parsing are each a different one.

package openapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
)

// renderBody — request JSONata → a request-body reader. pre-flight validates required
// fields (missing → reject, never send a malformed request). No body → nil reader (a
// legitimate empty body).
func renderBody(ob *opBinding, input any, required []string, media string) (io.Reader, error) {
	body, err := ob.evalRequest(input)
	if err != nil {
		return nil, err
	}
	if verr := checkRequired(body, required); verr != nil {
		return nil, verr
	}
	if body == nil {
		return nil, nil
	}
	return encodeBody(body, media)
}

// encodeBody — encodes by the **media type the spec declares** (F-C-54). This used to
// unconditionally `json.Marshal`, so a vendor that declares form encoding would receive
// JSON — it wouldn't say "wrong format", it would just see no fields at all (the real
// Mailgun's own words: `400 from parameter is missing`). Mailgun / Twilio / Stripe are all
// in this category.
//
// multipart is currently **explicitly unsupported** rather than silently sent as something
// else: sending the wrong encoding looks, from the other side, like "you didn't give these
// fields" — that kind of error sends whoever's debugging it off to check a binding that's
// actually completely correct.
func encodeBody(body any, media string) (io.Reader, error) {
	switch media {
	case "application/x-www-form-urlencoded":
		return encodeForm(body)
	case "multipart/form-data":
		return nil, fmt.Errorf("%w: this operation declares multipart/form-data",
			ErrUnsupportedBodyMedia)
	default:
		raw, merr := json.Marshal(body)
		if merr != nil {
			return nil, fmt.Errorf("marshal request body: %w", merr)
		}
		return bytes.NewReader(raw), nil
	}
}

// ErrUnsupportedBodyMedia — this instance cannot send the request-body encoding the spec
// declares. **Say so**, don't fall back to JSON: falling back gets you "field not given"
// from the other side while the binding was actually correct.
var ErrUnsupportedBodyMedia = errors.New("unsupported request body media type")

// encodeForm — a flat object → `a=1&b=2`. Forms have no nesting, so a nested value means
// **the binding is written wrong** — say so directly, don't silently stuff a chunk of JSON
// into some field.
func encodeForm(body any) (io.Reader, error) {
	m, ok := body.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: a form body must be a flat object", ErrUnsupportedBodyMedia)
	}
	form := url.Values{}
	for k, v := range m {
		s, serr := formValue(v)
		if serr != nil {
			return nil, fmt.Errorf("%w: field %q", serr, k)
		}
		form.Set(k, s)
	}
	return strings.NewReader(form.Encode()), nil
}

// formValue — the value of one form field. String/number/bool are fine; nesting is not.
func formValue(v any) (string, error) {
	switch t := v.(type) {
	case string:
		return t, nil
	case bool, float64, int, int64:
		return fmt.Sprint(t), nil
	default:
		return "", ErrUnsupportedBodyMedia
	}
}

// checkRequired — the body is missing any required field (missing key or null value) →
// ErrMissingRequired (pre-flight rejection).
func checkRequired(body any, required []string) error {
	if len(required) == 0 {
		return nil
	}
	m, ok := body.(map[string]any)
	if !ok {
		m = nil // a non-object body → treat all required fields as missing
	}
	for _, f := range required {
		if fieldMissing(m, f) {
			return fmt.Errorf("%w: %q", ErrMissingRequired, f)
		}
	}
	return nil
}
