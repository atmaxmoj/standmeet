package mcphandle_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
)

func run(out string) registry.MCPResult {
	invoke := func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(out), nil
	}
	return mcphandle.MCPHandlerFor(invoke)(context.Background(), "o", nil)
}

// An op's result may carry `_embeds`; the MCP face sends them as embedded resources after the
// text block and keeps them out of the text — the shape applications.commit returned as a fiber.
func TestEmbedsBecomeResourcesAndLeaveTheText(t *testing.T) {
	t.Parallel()
	pdf := []byte("%PDF-1.7 fake")
	got := run(`{"application_id":"a1","_embeds":[{"uri":"standmeet://application/a1",` +
		`"mime_type":"application/pdf","blob":"` + base64.StdEncoding.EncodeToString(pdf) + `"}]}`)
	want := registry.MCPResult{
		OK: true, Text: `{"application_id":"a1"}`,
		Embeddings: []registry.MCPEmbedded{
			{URI: "standmeet://application/a1", MIMEType: "application/pdf", Blob: pdf},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

// A result without `_embeds` passes through byte for byte.
func TestAResultWithoutEmbedsIsUntouched(t *testing.T) {
	t.Parallel()
	want := registry.MCPResult{
		OK: true, Text: `{"b":1, "a":2}`, Embeddings: []registry.MCPEmbedded{},
	}
	if got := run(`{"b":1, "a":2}`); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}
