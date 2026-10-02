package hostsocket

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// TestDispatchHandsHandlerTheKeysFiber — the fiber a handler acts for is the one the native key was
// minted for. A block that writes another fiber's id into its request changes nothing: the handler
// sees the key's fiber (per-fiber-schema.md, checkpoint 1).
func TestDispatchHandsHandlerTheKeysFiber(t *testing.T) {
	t.Parallel()
	var got string
	handlers := map[string]Handler{
		"do": func(ctx context.Context, _ json.RawMessage) (json.RawMessage, error) {
			got = hostop.CallerFiber(ctx)
			return json.RawMessage(`{"ok":true}`), nil
		},
	}
	verify := func(k string) (string, bool) { return "b_mine", k == "good" }
	s := &Server{log: slog.Default(), handlers: handlers, verify: verify}
	forged := `{"op":"do","native_key":"good","fiber_id":"b_theirs"}`
	s.dispatch(context.Background(), []byte(forged))
	if got != "b_mine" {
		t.Fatalf("handler acted for fiber %q, want the key's fiber %q", got, "b_mine")
	}
}
