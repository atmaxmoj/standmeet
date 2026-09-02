// validate.go — #155 zone A: spec-ingestion validation orchestration. The admin UI pastes/
// uploads/pulls an OpenAPI spec from a URL → this runs openapi.ValidateIngest (fetching first
// if it's a URL) → returns a candidate title or a human-readable rejection reason. Reuses the
// same 3.0 parser (unified), doesn't re-implement YAML parsing/validation on the frontend.

package connector

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// specFetchReason — the owner-friendly wording for a failed URL fetch (doesn't leak internals).
const specFetchReason = "could not fetch the spec from that URL (is it reachable?)"

// specBlockedReason — the case where the outbound guard blocked it by **policy**. Must be kept
// separate from the message above: that address is often completely reachable (F-C-23 was
// driven out with an address on the same docker network that wget could get a 200 from) — "is
// it unreachable?" would send the owner off debugging their own network, when the truth is this
// instance simply doesn't allow targeting the internal network. inference_models.go, in this
// same codebase, already makes this same distinction; this just applies the same cut here.
const specBlockedReason = "that URL points at an internal/private address, " +
	"which this instance does not allow"

// fetchReason — translates a fetch failure into the sentence shown to the owner. Only says
// "address policy" when it's **actually** an internal-network target: an unresolvable domain
// gets the original sentence (it's telling the truth), otherwise it would just be pointing the
// same lie in a different direction.
func fetchReason(err error) string {
	if errors.Is(err, ErrBlockedEgress) {
		return specBlockedReason
	}
	return specFetchReason
}

// AuthForms — derived credential form (an alias passing through, so adminroutes can use it via
// connectorsvc without importing connector directly).

// SpecVerdict — the result of ingestion validation: OK → Title (candidate title) + derived
// credential form; otherwise Reason (the rejection reason).
type SpecVerdict struct {
	Title  string
	Reason string
	Auth   AuthForms
	OK     bool
}

// specBaseURLReason — what's said when the owner-entered base URL fails to merge into this
// document.
const specBaseURLReason = "could not apply that base URL to the spec " +
	"(is the document an OpenAPI object?)"

// ValidateSpec — validate a spec pending ingestion. If url is non-empty, fetches it first
// (length-capped); if baseURL is non-empty, merges it into `servers` first (F-C-22: real
// vendor docs often ship without servers, and the owner shouldn't have to hand-edit the
// vendor's file). The result is an owner-friendly verdict (bad version / missing servers /
// operationId issues / external $ref / too large / fetch failed → Reason).
//
// When baseURL is empty, this changes **not a single byte**, so the old behavior — "a spec with
// no base URL entered still gets rejected for missing servers" — is preserved as-is: filling it
// in is what unblocks it, this isn't a case of no longer checking.
func (s *Service) ValidateSpec(
	ctx context.Context, spec []byte, url, baseURL string,
) SpecVerdict {
	raw := spec
	if url != "" {
		fetched, ferr := s.fetchSpec(ctx, url)
		if ferr != nil {
			return SpecVerdict{Reason: fetchReason(ferr)}
		}
		raw = fetched
	}
	normalized, aerr := openapi.ApplyBaseURL(raw, baseURL)
	if aerr != nil {
		return SpecVerdict{Reason: specBaseURLReason}
	}
	v := ValidateIngestSpec(normalized)
	return SpecVerdict(v)
}

// fetchSpec — pulls spec text from a URL (length-capped + non-2xx treated as failure).
// owner-only; any failure is uniformly reported back as ErrSpecFetch.
func (s *Service) fetchSpec(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("build spec fetch request: %w", err)
	}
	resp, derr := s.d.HTTP.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("fetch spec: %w", derr)
	}
	return readSpecResponse(resp)
}

// readSpecResponse — reads the response body (length-capped) + closes it + non-2xx treated as
// failure.
//
// **Reads one extra byte, purely to tell "too large" apart from "malformed"** (F-C-52). Reading
// exactly `MaxSpecBytes` would make the downstream check `len(raw) > MaxSpecBytes` never true,
// so a document that's **valid but too large** fails to parse right at the truncation point,
// and the product tells the owner "invalid JSON or YAML" — sending them off hunting for a
// syntax error that doesn't exist. This isn't an edge case in the real world: GitHub's own
// published `api.github.com.json` is 12 MB. The paste path has always gotten this right
// (`ValidateIngest` measures length first); it's this fetch path that couldn't reach the same
// sentence.
func readSpecResponse(resp *http.Response) ([]byte, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, int64(MaxSpecBytes)+1))
	if cerr := resp.Body.Close(); cerr != nil && rerr == nil {
		rerr = cerr
	}
	if rerr != nil {
		return nil, fmt.Errorf("read fetched spec: %w", rerr)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("fetch spec: status %d", resp.StatusCode)
	}
	return raw, nil
}
