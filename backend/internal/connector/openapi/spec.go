// spec.go — minimal parsing of an OpenAPI 3.0.x / 3.1.x spec. The runtime needs only three
// things: server base URL, operationId → {method,path}, securitySchemes (to derive the
// credential form + inject auth). Parsing this subset ourselves = zero heavyweight
// dependencies, cleanest. JSON is also valid YAML 1.2, so whether the owner pastes a JSON or
// YAML spec, both go through this one parser; accepts 3.0.x / 3.1.x.

package openapi

import (
	"fmt"
	"slices"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// Spec — the subset of an OpenAPI 3.0 document the runtime actually uses.
type Spec struct {
	Paths      map[string]map[string]operation `yaml:"paths"`
	Components components                      `yaml:"components"`
	Info       specInfo                        `yaml:"info"`
	OpenAPI    string                          `yaml:"openapi"`
	Servers    []server                        `yaml:"servers"`
}

// specInfo — the spec's info block (shows the title to the owner for confirmation at
// ingest).
type specInfo struct {
	Title string `yaml:"title"`
}

// Title — the spec's info.title (shown at ingest as the candidate).
func (s *Spec) Title() string { return s.Info.Title }

type server struct {
	URL string `yaml:"url"`
}

type operation struct {
	RequestBody requestBody `yaml:"requestBody"`
	OperationID string      `yaml:"operationId"`
	Summary     string      `yaml:"summary"`
	Description string      `yaml:"description"`
	// Security — which scopes **this one action** needs. OpenAPI's standard location.
	//
	// Not the same thing as the scope table under components.securitySchemes: that one says
	// "what this connector might ever need", this one says "which one this step needs".
	// Without this, the host has only "what the owner granted" with no counterpart to check
	// it against, so a read-only-scoped connection would still offer write operations to a
	// visitor — every single one 403ing (F-B-8).
	Security []map[string][]string `yaml:"security"`
}

// requestBody/mediaType/bodySchema — only pulls application/json's schema.required (runtime
// pre-flight validation: the body the request JSONata evaluated to is missing a required
// field → reject, never send a malformed request).
type requestBody struct {
	Content map[string]mediaType `yaml:"content"`
}

type mediaType struct {
	Schema bodySchema `yaml:"schema"`
}

type bodySchema struct {
	Required []string `yaml:"required"`
}

type components struct {
	SecuritySchemes map[string]SecurityScheme `yaml:"securitySchemes"`
}

// SecurityScheme — one authentication method the spec declares; both deriving the
// credential form and injecting auth read this.
type SecurityScheme struct {
	Flows            OAuthFlows `yaml:"flows"`
	Type             string     `yaml:"type"`
	Scheme           string     `yaml:"scheme"`
	In               string     `yaml:"in"`
	Name             string     `yaml:"name"`
	OpenIDConnectURL string     `yaml:"openIdConnectUrl"`
}

// OAuthFlows — the set of oauth2 flows (used to derive the form + the OAuth dance).
type OAuthFlows struct {
	AuthorizationCode *OAuthFlow `yaml:"authorizationCode"`
	ClientCredentials *OAuthFlow `yaml:"clientCredentials"`
}

// OAuthFlow — one oauth2 flow's endpoints + scopes.
type OAuthFlow struct {
	Scopes           map[string]string `yaml:"scopes"`
	AuthorizationURL string            `yaml:"authorizationUrl"`
	TokenURL         string            `yaml:"tokenUrl"`
}

// resolvedOp — the concrete HTTP operation an operationId resolves to.
type resolvedOp struct {
	Method string
	Path   string
	// BodyMedia — the media type requestBody declares. **Read from the spec, never assumed**
	// (F-C-54): this used to only look for `application/json`, and the runtime was hardcoded
	// to send JSON, so any form-encoded vendor couldn't be reached at all — the real
	// Mailgun's response to a JSON body is `400 from parameter is missing`; it simply never
	// saw those fields. Mailgun / Twilio / Stripe are all in this category. Empty = no
	// request body declared.
	BodyMedia string
	Required  []string // schema.required for the selected media type (pre-flight validation)
}

// ParseSpec — parses spec source (JSON or YAML). Not 3.0.x / 3.1.x → error (the version gate
// lives here). The runtime only reads paths/operations, requestBody.required,
// securitySchemes, servers — these are structurally identical across 3.0 and 3.1
// (bodySchema only takes the `required` list; 3.1's `type: [..]` array falls on an
// undeclared field and is ignored), so 3.1 is safe to let through.
func ParseSpec(raw []byte) (*Spec, error) {
	var s Spec
	if err := yaml.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("parse openapi spec: %w", err)
	}
	if !strings.HasPrefix(s.OpenAPI, "3.0") && !strings.HasPrefix(s.OpenAPI, "3.1") {
		return nil, fmt.Errorf(
			"unsupported openapi version %q: only 3.0.x / 3.1.x is supported", s.OpenAPI,
		)
	}
	if len(s.Paths) == 0 {
		return nil, ErrSpecNoOperations
	}
	return &s, nil
}

// SecuritySchemes — the authentication methods the spec declares (used to derive the
// credential form).
func (s *Spec) SecuritySchemes() map[string]SecurityScheme {
	return s.Components.SecuritySchemes
}

// ScopesFor — **which scopes this operation needs** (the set the spec declares itself).
// Undeclared → an empty slice, which the caller treats as "this step requires no extra
// permission".
//
// This is the right-hand side of the judgment "granted ⊇ required". The left-hand side
// (what was granted) lives on the connection row. Both sides must be **data**: copying
// scope names into Go creates a second source of truth, and it will eventually diverge
// from the spec (F-B-8 / [[vocabulary-must-not-diverge]]).
func (s *Spec) ScopesFor(operationID string) []string {
	for _, methods := range s.Paths {
		for _, op := range methods {
			if op.OperationID == operationID {
				return flattenSecurity(op.Security)
			}
		}
	}
	// An empty slice, not nil — the comment above says "empty slice", and the code
	// used to return nil; the gate caught that exact inconsistency on the spot
	// (collections always return empty).
	return []string{}
}

// ServerURLs — every server's base URL (used by the outbound SSRF guard at assembly-time
// validation).
func (s *Spec) ServerURLs() []string {
	out := make([]string, 0, len(s.Servers))
	for i := range s.Servers {
		out = append(out, s.Servers[i].URL)
	}
	return out
}

// OpInfo — one operation's agent-facing metadata (agent path: each op is exposed as a tool;
// Summary/Description feed the LLM as the tool description).
type OpInfo struct {
	ID          string
	Summary     string
	Description string
}

// Operations — every operation in the spec that has an operationId (the agent path exposes
// each op as a tool).
func (s *Spec) Operations() []OpInfo {
	out := make([]OpInfo, 0)
	for _, methods := range s.Paths {
		for _, op := range methods {
			if op.OperationID != "" {
				out = append(out, OpInfo{
					ID: op.OperationID, Summary: op.Summary, Description: op.Description,
				})
			}
		}
	}
	return out
}

// serverURL — the first server's base URL (trailing slash removed). None → empty string.
func (s *Spec) serverURL() string {
	if len(s.Servers) == 0 {
		return ""
	}
	return strings.TrimRight(s.Servers[0].URL, "/")
}

// operation — finds the concrete HTTP operation by operationId. Not found → ok=false.
func (s *Spec) lookup(operationID string) (resolvedOp, bool) {
	for path, methods := range s.Paths {
		for method, op := range methods {
			if op.OperationID == operationID {
				media, schema := pickBodyMedia(op.RequestBody.Content)
				return resolvedOp{
					Method: strings.ToUpper(method), Path: path,
					BodyMedia: media, Required: schema.Required,
				}, true
			}
		}
	}
	return resolvedOp{}, false
}

// pickBodyMedia — which media type requestBody declares. **JSON takes priority** (existing
// connectors don't change a single byte), and without JSON it takes the lexicographically
// smallest one declared — what's wanted is **determinism**, and map iteration order isn't
// that. None declared = this operation has no request body.
func pickBodyMedia(content map[string]mediaType) (string, bodySchema) {
	if m, ok := content["application/json"]; ok {
		return "application/json", m.Schema
	}
	names := make([]string, 0, len(content))
	for name := range content {
		names = append(names, name)
	}
	if len(names) == 0 {
		return "", bodySchema{}
	}
	slices.Sort(names)
	return names[0], content[names[0]].Schema
}

// flattenSecurity — OpenAPI's security is "a set of alternatives, each alternative a
// scheme→scopes map". We only use one authentication method, so flattening + de-duping is
// enough; the day there are genuinely two alternatives, this must change to "any one
// alternative satisfies it" instead of merging like it does now (written here so that day
// doesn't get misread).
func flattenSecurity(security []map[string][]string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, alt := range security {
		out = appendUnseen(out, seen, alt)
	}
	return out
}

func appendUnseen(out []string, seen map[string]bool, alt map[string][]string) []string {
	for _, scopes := range alt {
		for _, sc := range scopes {
			if seen[sc] {
				continue
			}
			seen[sc] = true
			out = append(out, sc)
		}
	}
	return out
}

// operationIDs — every operationId in the spec (de-duplicated). Used by binding validation
// to check "references an op that doesn't exist".
func (s *Spec) operationIDs() map[string]struct{} {
	ids := map[string]struct{}{}
	for _, methods := range s.Paths {
		for _, op := range methods {
			if op.OperationID != "" {
				ids[op.OperationID] = struct{}{}
			}
		}
	}
	return ids
}
