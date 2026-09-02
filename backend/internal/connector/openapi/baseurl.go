// baseurl.go — the owner-supplied base URL, merged into the spec at the **boundary**.
//
// Real vendor docs often ship without a usable `servers` field (Cal.com v2 writes an explicit
// `"servers": []`), while the ingest gate requires one (ingest.go). The owner's only workaround
// would be to hand-edit the vendor's file — exactly what connector-assembly check 2 explicitly
// forbids (F-C-22).
//
// **Why "normalize" instead of "thread an override downstream":** validation, assembly, runtime,
// outbound SSRF static checks, credential-form derivation — all five read the same spec bytes.
// An extra override parameter means all five sites must remember it exists; missing one produces
// the "base URL present at assembly time, absent at runtime" hole that only blows up on a real
// call. Merging it into the document at the entry point means every downstream site sees one
// **plain spec** — nothing there has to change.
//
// **Idempotence comes from structure, not text:** we set a map key instead of splicing text.
// When the spec already has `servers`, we overwrite it, so we never produce two `servers` keys —
// which is exactly how a hand-spliced insert breaks (duplicate key, legally rejected by the YAML
// parser).

package openapi

import (
	"errors"
	"fmt"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// errSpecNotAMapping — the document's top level isn't a mapping (e.g. a list or a scalar),
// so there's nowhere to put servers.
var errSpecNotAMapping = errors.New("the spec is not an object at its top level")

// ApplyBaseURL — writes the owner-supplied base URL into the spec's `servers`, returning the
// normalized document bytes. baseURL empty → returned as-is (zero changes, not even parsed).
// JSON goes through this path too: YAML is a superset of JSON, so it decodes into the same map,
// and ParseSpec accepts it just the same after being re-marshaled as YAML.
func ApplyBaseURL(raw []byte, baseURL string) ([]byte, error) {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		return raw, nil
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("apply base url: %w", err)
	}
	if doc == nil {
		return nil, fmt.Errorf("apply base url: %w", errSpecNotAMapping)
	}
	doc["servers"] = []any{map[string]any{"url": trimmed}}
	out, merr := yaml.Marshal(doc)
	if merr != nil {
		return nil, fmt.Errorf("apply base url: %w", merr)
	}
	return out, nil
}
