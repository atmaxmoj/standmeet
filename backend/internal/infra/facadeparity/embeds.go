// embeds.go —— the `_embeds` convention on an Invoke result (see Invoke): binary attachments that
// a face able to carry them sends beside the JSON, and a JSON face leaves in place.

package facadeparity

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// EmbedsKey —— the reserved top-level field.
const EmbedsKey = "_embeds"

// Embed —— one attachment; Blob is base64 in the JSON.
type Embed struct {
	URI      string `json:"uri"`
	MIMEType string `json:"mime_type"`
	Blob     []byte `json:"blob"`
}

// Split —— a result taken apart: the JSON without `_embeds`, and the attachments.
type Split struct {
	Text   string
	Embeds []Embed
}

// SplitEmbeds —— takes `_embeds` out of a result object. A result without it (or not an
// object) comes back byte for byte with no attachments.
func SplitEmbeds(out json.RawMessage) (Split, error) {
	fields, ok := objectWithEmbeds(out)
	if !ok {
		return Split{Text: string(out)}, nil
	}
	var embeds []Embed
	if err := json.Unmarshal(fields[EmbedsKey], &embeds); err != nil {
		return Split{}, fmt.Errorf("decode %s: %w", EmbedsKey, err)
	}
	delete(fields, EmbedsKey)
	text, err := json.Marshal(fields)
	if err != nil {
		return Split{}, fmt.Errorf("encode result: %w", err)
	}
	return Split{Text: string(text), Embeds: embeds}, nil
}

// objectWithEmbeds —— the result's fields, when it is an object that carries `_embeds`.
func objectWithEmbeds(out json.RawMessage) (map[string]json.RawMessage, bool) {
	fields := map[string]json.RawMessage{}
	if !bytes.Contains(out, []byte(`"`+EmbedsKey+`"`)) || json.Unmarshal(out, &fields) != nil {
		return map[string]json.RawMessage{}, false
	}
	_, ok := fields[EmbedsKey]
	return fields, ok
}
