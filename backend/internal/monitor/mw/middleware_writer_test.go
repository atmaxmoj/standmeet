// middleware_writer_test.go —— the recorder must hand on the writer capabilities it does not use.
//
// Record wraps EVERY public route, `POST /api/v1/agent/turn` (the visitor chat SSE) included.
// The wrapper embeds the http.ResponseWriter interface, which promotes three methods and drops
// everything else — and both things a streaming handler needs live outside that interface:
// http.Flusher, and the write deadline http.NewResponseController sets. Losing them raises no
// error anywhere: writeSSEFrame skips a nil flusher, extendStreamWriteDeadline logs a WARN. The
// visitor just stops seeing progress, and a long turn just gets cut.
//
// So these assert reachability THROUGH the recorder, not that the recorder compiles.

package mw

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// flushableWriter —— a ResponseWriter that counts flushes and accepts a write deadline, i.e. the
// capabilities a real *http.response has and the recorder must not swallow.
type flushableWriter struct {
	http.ResponseWriter

	deadline time.Time
	flushes  int
}

func (f *flushableWriter) Flush() { f.flushes++ }

func (f *flushableWriter) SetWriteDeadline(t time.Time) error {
	f.deadline = t
	return nil
}

func newRecorderOver() (*flushableWriter, *statusRecorder) {
	under := &flushableWriter{ResponseWriter: httptest.NewRecorder()}
	return under, &statusRecorder{ResponseWriter: under, status: http.StatusOK}
}

// A plain type assertion must still find a flusher: that is exactly how the SSE writers look for
// one (inference/proxy.go pickFlusher), and a type assertion does not follow Unwrap.
func TestStatusRecorderStaysAFlusher(t *testing.T) {
	t.Parallel()
	under, rec := newRecorderOver()

	var w http.ResponseWriter = rec
	flusher, ok := w.(http.Flusher)
	if !ok {
		t.Fatal("statusRecorder is not an http.Flusher — every SSE frame under Record buffers " +
			"until the handler returns")
	}
	flusher.Flush()
	if under.flushes != 1 {
		t.Fatalf("Flush did not reach the wrapped writer: flushes=%d, want 1", under.flushes)
	}
}

// http.NewResponseController must reach through to the write deadline, or
// http.Server.WriteTimeout cuts any turn that outlives it (F-A-44).
func TestStatusRecorderPassesTheWriteDeadline(t *testing.T) {
	t.Parallel()
	under, rec := newRecorderOver()

	want := time.Now().Add(time.Hour)
	if err := http.NewResponseController(rec).SetWriteDeadline(want); err != nil {
		t.Fatalf("SetWriteDeadline through the recorder: %v", err)
	}
	if !under.deadline.Equal(want) {
		t.Fatalf("write deadline did not reach the wrapped writer: got %v, want %v",
			under.deadline, want)
	}
}

// The recorder still does its own job.
func TestStatusRecorderStillRecordsTheStatus(t *testing.T) {
	t.Parallel()
	_, rec := newRecorderOver()

	rec.WriteHeader(http.StatusTeapot)
	if rec.status != http.StatusTeapot {
		t.Fatalf("status not recorded: got %d, want %d", rec.status, http.StatusTeapot)
	}
}
