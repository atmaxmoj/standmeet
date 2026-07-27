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

// TestRunAgentTurnTimesOutOnHangingUpstream —— 复现 + 修复验证:第三方 LLM 卡住
// 时,一整轮 agent turn 必须在 deadline 内被切断,而不是无限 retrieving。
//
// 用一个"挂死"的上游(收到请求就阻塞)冒充 DeepSeek。没有 per-turn timeout 时,
// SSE handler 的 ctx 永不取消 → RunAgentTurn 永不返回(本测试 10s 兜底会 fail)。
// 加了 WithTimeout 后,1s 到点 → in-flight LLM 调用 ctx 被取消 → 错误冒上来 → 返回,
// 且 UI 收到的是友好 timeout 文案,不是 raw NodeRunError。
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
