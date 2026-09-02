package inference

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	maxReturn    = 6 * time.Second
	hangFallback = 10 * time.Second
)

// TestRunAgentTurnTimesOutOnHangingUpstream —— reproduction + fix verification: when a
// third-party LLM hangs, an entire agent turn must be cut off within the deadline, not left
// "retrieving" forever.
//
// Impersonates DeepSeek with a "hung" upstream (blocks as soon as it receives a request).
// Without a per-turn timeout, the SSE handler's ctx never cancels → RunAgentTurn never
// returns (this test's 10s backstop would then fail). With WithTimeout added, the moment 1s
// hits → the in-flight LLM call's ctx gets cancelled → the error surfaces → it returns, and
// the UI receives friendly timeout copy, not a raw NodeRunError.
func TestRunAgentTurnTimesOutOnHangingUpstream(t *testing.T) {
	stop := make(chan struct{})
	hung := hangingUpstream(stop)
	defer hung.Close()
	defer close(stop) // LIFO: unblock the handler before Close() waits on it

	t.Setenv("AGENT_TURN_TIMEOUT", "1") // 1s cap for the test

	w := httptest.NewRecorder()
	done := make(chan struct{})
	start := time.Now()
	go func() {
		RunAgentTurn(context.Background(), discardLog(), w, hungTurnInput(hung.URL))
		close(done)
	}()

	select {
	case <-done:
		assertFriendlyTimeout(t, w, time.Since(start))
	case <-time.After(hangFallback):
		t.Fatal("RunAgentTurn HUNG past 10s — per-turn timeout not effective " +
			"(does the eino model honor ctx cancellation on the in-flight call?)")
	}
}

// hangingUpstream —— an HTTP server that blocks every request until its ctx is
// cancelled (what our per-turn timeout must do) or the test tears it down.
func hangingUpstream(stop chan struct{}) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-stop:
		}
	}))
}

func hungTurnInput(endpoint string) *AgentTurnInput {
	return &AgentTurnInput{
		Cred: &Cred{Provider: "openai", Key: "test-key", Endpoint: endpoint, Model: "test-model"},
		Req:  &AgentTurnRequest{System: "test persona", UserMessage: "hello", Model: "test-model"},
		Mode: "public",
	}
}

func discardLog() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

func assertFriendlyTimeout(t *testing.T, w *httptest.ResponseRecorder, elapsed time.Duration) {
	t.Helper()
	body := w.Body.String()
	t.Logf("RunAgentTurn returned after %v; body=%q", elapsed, body)
	if elapsed > maxReturn {
		t.Fatalf("returned after %v — past the 1s timeout; not bounding the hang", elapsed)
	}
	if !strings.Contains(body, `"code":"timeout"`) {
		t.Errorf("expected a friendly timeout error frame, got: %q", body)
	}
	if strings.Contains(body, "NodeRunError") || strings.Contains(body, "node path") {
		t.Errorf("raw upstream error leaked to the user: %q", body)
	}
}
