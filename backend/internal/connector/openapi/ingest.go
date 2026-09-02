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
	"log/slog"
	"os"
	"slices"
	"strconv"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// defaultMaxSpecBytes — the default size cap for an ingested spec (guards against an
// oversized/runaway spec).
const defaultMaxSpecBytes = 2 << 20 // 2 MiB

// MaxSpecBytes — how large a spec this instance actually accepts. **The owner can configure
// it** (`CONNECTOR_SPEC_MAX_BYTES`).
//
// Why it can't be a constant: this section's copy invites the owner to "upload your own
// OpenAPI connector", and real-world vendor docs often run far past 2 MiB — GitHub's own
// published `api.github.com.json` is **12 MB** — so this product would flatly say "can't
// install it" for one of its most common APIs, with no knob for the owner to turn (F-C-53).
// The cap itself is correct (a runaway document shouldn't be able to bring down the
// instance); **"how large" is a deployment concern, not a compile-time one.**
// **The name must appear as a literal in `os.Getenv("…")`**: `check-knobs-reachable` finds
// knobs exactly that way. The first version wrote `envBytesOr("CONNECTOR_SPEC_MAX_BYTES", …)`
// (the name went into the helper's parameter), and the gate went blind to it on the spot —
// that gate had only just been widened that same morning from "scan only config.go". **A
// hardened gate gets routed around by the next new way of writing it**, so the value-reading
// helper takes only the **value**, never the key.
var MaxSpecBytes = bytesOr(os.Getenv("CONNECTOR_SPEC_MAX_BYTES"), defaultMaxSpecBytes)

// bytesOr — reads a byte-count env var's value as a positive integer; empty/invalid/non-
// positive → falls back to the default. An invalid value is never swallowed silently: it
// logs once, then falls back (a typo'd knob shouldn't lock the instance at 0).
func bytesOr(raw string, def int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		slog.Default().Warn("ignoring unusable CONNECTOR_SPEC_MAX_BYTES, using the default",
			"value", raw, "default", def)
		return def
	}
	return n
}

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
// This is exactly the string shown on `CONNECTOR CANDIDATE` at the moment of ingest. It's
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
