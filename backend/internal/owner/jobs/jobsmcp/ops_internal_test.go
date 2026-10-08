package jobsmcp

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// Lifting a binding into an op must not change what the owner's AI receives: the error text
// verbatim, a plain result byte for byte, an embedded PDF back out of `_embeds` as the same
// resource after the same JSON.

func callLifted(r registry.MCPResult) (json.RawMessage, error) {
	h := func(context.Context, string, json.RawMessage) registry.MCPResult { return r }
	return invokeOf(h)(context.Background(), "owner", nil)
}

func TestInvokeOfKeepsTheErrorText(t *testing.T) {
	t.Parallel()
	_, err := callLifted(registry.MCPError("draft not found"))
	if err == nil || err.Error() != "draft not found" {
		t.Fatalf("error text: got %v", err)
	}
}

func TestInvokeOfKeepsAPlainResultByteForByte(t *testing.T) {
	t.Parallel()
	plain := `{"b":1, "a":[2]}`
	out, err := callLifted(registry.MCPSuccessWithEmbeddings(plain, nil))
	if err != nil || string(out) != plain {
		t.Fatalf("plain result changed: %q %v", out, err)
	}
}

func TestInvokeOfCarriesEmbedsBack(t *testing.T) {
	t.Parallel()
	pdf := registry.MCPEmbedded{
		URI: "standmeet://x", MIMEType: "application/pdf", Blob: []byte("%PDF"),
	}
	res := registry.MCPSuccessWithEmbeddings(`{"id":"d1"}`, []registry.MCPEmbedded{pdf})
	out, err := callLifted(res)
	if err != nil {
		t.Fatal(err)
	}
	split, err := fp.SplitEmbeds(out)
	if err != nil {
		t.Fatal(err)
	}
	want := fp.Split{Text: `{"id":"d1"}`, Embeds: []fp.Embed{{
		URI: pdf.URI, MIMEType: pdf.MIMEType, Blob: pdf.Blob,
	}}}
	if !reflect.DeepEqual(split, want) {
		t.Fatalf("embeds round trip: got %+v, want %+v", split, want)
	}
}
