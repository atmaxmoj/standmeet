// ingest.go — #155 area A: spec ingest validation. The owner pastes/uploads an OpenAPI spec
// in the admin UI; this gives a human-readable accept/reject verdict (before it goes on to
// binding/assembly). Reuses ParseSpec (the same 3.0/3.1 parser, JSON+YAML), layering on
// ingest-specific gates: a size cap, servers required, every operation needs a unique
// operationId, no external $ref. Error text goes straight to the owner (no stack leaks), so
// it uses plain error text rather than sentinels.

package openapi

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// MaxSpecBytes — how large a spec this instance accepts: a guard against a runaway document, set
// above the real vendor specs owners connect. GitHub's published `api.github.com.json` is 12 MB;
// at the old 2 MiB the product refused one of its most common APIs (F-C-53). This was an env knob
// for a while; the owner's rule is that a deployment carries wiring, not settings, and a cap
// that fits the real specs needs no knob.
const MaxSpecBytes = 16 << 20 // 16 MiB

// ValidateIngest — validates a spec pending ingest. OK → returns the candidate title
// (info.title); otherwise → a human-readable error.
func ValidateIngest(raw []byte) (string, error) {
	if len(raw) > MaxSpecBytes {
		return "", fmt.Errorf("spec is too large (over the %d MiB size limit)", MaxSpecBytes>>20)
	}
	spec, err := ParseSpec(raw)
	if err != nil {
		return "", ingestParseError(err)
	}
	if cerr := checkIngestSemantics(spec, raw); cerr != nil {
		return "", cerr
	}
	return spec.Title(), nil
}

// SpecTitle — the name the vendor gave this API themselves (info.title). Unreadable → empty
// string.
//
// This is exactly the string shown on `SUPPLIER CANDIDATE` at the moment of ingest. It's
// fetched again and stored at assembly time, so the list doesn't have to re-parse a 12.9 MB
// document just to get a name (F-C-56).
func SpecTitle(raw []byte) string {
	spec, err := ParseSpec(raw)
	if err != nil {
		return ""
	}
	return spec.Title()
}

// checkIngestSemantics — post-parse ingest semantic gates: servers required, operationId
// present and unique, no external $ref.
func checkIngestSemantics(spec *Spec, raw []byte) error {
	if len(spec.ServerURLs()) == 0 {
		return errors.New("the spec defines no servers (a base URL is required)")
	}
	if oerr := checkOperationIDs(spec); oerr != nil {
		return oerr
	}
	return checkNoExternalRefs(raw)
}

// ingestParseError — maps a ParseSpec error into ingest-facing copy: version mismatch →
// points out only 3.0/3.1 is accepted; empty paths → points out there are no operations;
// everything else → could not parse.
func ingestParseError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "unsupported openapi version"), strings.Contains(msg, "only 3.0"):
		return errors.New("only OpenAPI 3.0.x / 3.1.x is supported (not Swagger 2.0)")
	case errors.Is(err, ErrSpecNoOperations):
		return errors.New("the spec defines no operations (paths are empty)")
	default:
		return errors.New("could not parse the spec (invalid JSON or YAML)")
	}
}

// checkOperationIDs — every operation must have an operationId and it must be globally
// unique (a binding points to it uniquely).
func checkOperationIDs(spec *Spec) error {
	seen := map[string]struct{}{}
	for _, methods := range spec.Paths {
		for _, op := range methods {
			if err := registerOpID(seen, op.OperationID); err != nil {
				return err
			}
		}
	}
	return nil
}

func registerOpID(seen map[string]struct{}, id string) error {
	if id == "" {
		return errors.New("an operation is missing its operationId (every operation needs one)")
	}
	if _, dup := seen[id]; dup {
		return fmt.Errorf("duplicate operationId %q (each operation must be unique)", id)
	}
	seen[id] = struct{}{}
	return nil
}

// checkNoExternalRefs — walks the whole document for $ref; any that doesn't start with "#"
// (an external file/URL) → rejected, cannot parse.
func checkNoExternalRefs(raw []byte) error {
	var doc any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("scan spec refs: %w", err) // unreachable in practice (ParseSpec
		// already validated parseability)
	}
	if externalRefIn(doc) {
		return errors.New("the spec has an external $ref that cannot be resolved " +
			"(use only internal #/… references)")
	}
	return nil
}

// externalRefIn — recursively finds any "$ref" value that doesn't start with "#".
func externalRefIn(node any) bool {
	switch v := node.(type) {
	case map[string]any:
		return externalRefInMap(v)
	case []any:
		return slices.ContainsFunc(v, externalRefIn)
	}
	return false
}

func externalRefInMap(m map[string]any) bool {
	for key, val := range m {
		if key == "$ref" && isExternalRef(val) {
			return true
		}
		if externalRefIn(val) {
			return true
		}
	}
	return false
}

// isExternalRef — the $ref value is a string and doesn't start with "#" (same document) →
// external reference.
func isExternalRef(val any) bool {
	ref, ok := val.(string)
	return ok && !strings.HasPrefix(ref, "#")
}
