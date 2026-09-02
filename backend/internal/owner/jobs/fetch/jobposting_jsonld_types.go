// jobposting_jsonld_types.go — lenient decoders for schema.org's loosely-typed
// JobPosting fields. Real pages disagree on shape: @type is a string or an
// array; jobLocation is an object or an array; identifier.value is a string or
// an integer; a block is a bare object, an array, or a {"@graph":[...]} wrapper.
// Each type below normalizes one of those at the decode boundary so the mapping
// code sees a single shape (CLAUDE.md §A.4: normalize once at the entry point).

package fetch

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// jsonLDNode — a top-level ld+json block: a single object, an array of objects,
// or a {"@graph":[...]} wrapper. postings() flattens all three to a slice.
type jsonLDNode struct {
	items []jsonLDPosting
}

// isJSONEmpty — a trimmed JSON value that carries nothing (empty or literal null).
func isJSONEmpty(b []byte) bool {
	return len(b) == 0 || string(b) == "null"
}

func (n *jsonLDNode) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if isJSONEmpty(b) {
		return nil
	}
	if b[0] == '[' {
		if err := json.Unmarshal(b, &n.items); err != nil {
			return fmt.Errorf("jsonld node array: %w", err)
		}
		return nil
	}
	return n.decodeObject(b)
}

// decodeObject reads a single-object block: a {"@graph":[...]} wrapper, else a
// bare posting object.
func (n *jsonLDNode) decodeObject(b []byte) error {
	if items, ok := graphItems(b); ok {
		n.items = items
		return nil
	}
	var single jsonLDPosting
	if err := json.Unmarshal(b, &single); err != nil {
		return fmt.Errorf("jsonld node object: %w", err)
	}
	n.items = []jsonLDPosting{single}
	return nil
}

func (n *jsonLDNode) postings() []jsonLDPosting { return n.items }

// graphItems returns the @graph array of a block, if it is a graph wrapper.
func graphItems(b []byte) ([]jsonLDPosting, bool) {
	var graph struct {
		Graph []jsonLDPosting `json:"@graph"`
	}
	if err := json.Unmarshal(b, &graph); err == nil && len(graph.Graph) > 0 {
		return graph.Graph, true
	}
	return []jsonLDPosting{}, false
}

// jsonLDPosting — the subset of schema.org JobPosting the adapter maps.
type jsonLDPosting struct {
	Type               jsonLDStrings    `json:"@type"`
	Title              string           `json:"title"`
	Description        string           `json:"description"`
	DatePosted         string           `json:"datePosted"`
	JobLocationType    string           `json:"jobLocationType"`
	EmploymentType     jsonLDStrings    `json:"employmentType"`
	HiringOrganization jsonLDOrg        `json:"hiringOrganization"`
	JobLocation        jsonLDLocations  `json:"jobLocation"`
	Identifier         jsonLDIdentifier `json:"identifier"`
}

type jsonLDOrg struct {
	Name string `json:"name"`
}

// jsonLDStrings — a field that is a string OR an array of strings (@type,
// employmentType). Used with has() for @type and values() for tags.
type jsonLDStrings struct {
	vals []string
}

func (s *jsonLDStrings) UnmarshalJSON(b []byte) error {
	return unmarshalStringOrArray(b, &s.vals)
}

func (s *jsonLDStrings) values() []string { return s.vals }

func (s *jsonLDStrings) has(want string) bool {
	for _, v := range s.vals {
		if strings.Contains(v, want) {
			return true
		}
	}
	return false
}

// jsonLDIdentifier — {"value": ...} where value is a string OR an integer.
type jsonLDIdentifier struct {
	Value json.RawMessage `json:"value"`
}

func (i *jsonLDIdentifier) value() string {
	b := bytes.TrimSpace(i.Value)
	if len(b) == 0 || string(b) == "null" {
		return ""
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			return s
		}
		return ""
	}
	return string(b) // a number literal, e.g. 2726129
}

// jsonLDLocations — jobLocation as an object OR an array of Place objects.
type jsonLDLocations struct {
	places []jsonLDPlace
}

type jsonLDPlace struct {
	Address jsonLDAddress `json:"address"`
}

type jsonLDAddress struct {
	Locality string `json:"addressLocality"`
	Region   string `json:"addressRegion"`
	Country  string `json:"addressCountry"`
}

func (l *jsonLDLocations) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if isJSONEmpty(b) {
		return nil
	}
	if b[0] == '[' {
		if err := json.Unmarshal(b, &l.places); err != nil {
			return fmt.Errorf("jsonld location array: %w", err)
		}
		return nil
	}
	var one jsonLDPlace
	if err := json.Unmarshal(b, &one); err != nil {
		return fmt.Errorf("jsonld location object: %w", err)
	}
	l.places = []jsonLDPlace{one}
	return nil
}

// line renders the first location as "Locality, Region, Country" (empty parts
// dropped) — the only location most postings carry that a reader needs.
func (l *jsonLDLocations) line() string {
	if len(l.places) == 0 {
		return ""
	}
	a := l.places[0].Address
	parts := make([]string, 0, 3)
	parts = appendIfNonEmpty(parts, a.Locality)
	parts = appendIfNonEmpty(parts, a.Region)
	parts = appendIfNonEmpty(parts, a.Country)
	return strings.Join(parts, ", ")
}

// unmarshalStringOrArray decodes a JSON string or array-of-strings into out.
// null/empty leaves out untouched (nil slice).
func unmarshalStringOrArray(b []byte, out *[]string) error {
	b = bytes.TrimSpace(b)
	if isJSONEmpty(b) {
		return nil
	}
	if b[0] == '[' {
		if err := json.Unmarshal(b, out); err != nil {
			return fmt.Errorf("jsonld strings array: %w", err)
		}
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("jsonld string: %w", err)
	}
	*out = []string{s}
	return nil
}
