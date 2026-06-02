// inference_stream.go —— POST /api/v1/inference/stream
//
// Backend is a thin proxy: receives messages + system + tools from the
// browser's pi-agent-core (@standmeet/agent-core), opens an upstream
// /v1/messages call against the owner's (or visitor BYOAI's) Anthropic
// endpoint, and io.Copy's the SSE bytes straight back to the visitor.
// No SSE parsing, no event translation, no goroutines, no channels —
// pi-agent-core in the browser consumes the Anthropic native stream
// and runs the agent loop.
//
// Auth Bearer visitor session token. Body matches what pi-agent-core's
// httpInferenceStreamer sends:
//
//	{ system: string, messages: [{role, content: [content_block...]}],
//	  tools?: [{name, description, input_schema}] }
//
// Response: Anthropic /v1/messages SSE byte-for-byte.

package public

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
)

// inferenceStreamRequest —— what pi-agent-core POSTs. messages.content
// is a JSON array of content blocks (text / tool_use / tool_result) so
// backend can forward them straight into the Anthropic body.
type inferenceStreamRequest struct {
	System   string                  `json:"system"`
	Model    string                  `json:"model,omitempty"`
	Messages []inferenceStreamMsg    `json:"messages"`
	Tools    []inferenceStreamToolIn `json:"tools,omitempty"`
}

type inferenceStreamMsg struct {
	Role    string            `json:"role"`
	Content []json.RawMessage `json:"content"`
}

type inferenceStreamToolIn struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

func (h *Handlers) inferenceStream() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		var req inferenceStreamRequest
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runInferenceProxy(h, w, r, auth, &req)
	}
}

func runInferenceProxy(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	auth authedVisitor, req *inferenceStreamRequest,
) {
	upstream, err := openInferenceUpstream(r, h, auth, req)
	if err != nil {
		writeStreamErr(h.Log, w, err)
		return
	}
	defer closeUpstreamBody(h.Log, upstream)
	forwardSSEBytes(h.Log, w, upstream.Body)
}

func openInferenceUpstream(
	r *http.Request, h *Handlers, auth authedVisitor,
	req *inferenceStreamRequest,
) (*http.Response, error) {
	cred, cerr := resolveStreamCred(r, h, auth, req)
	if cerr != nil {
		return nil, cerr
	}
	return inference.OpenAnthropicStream(r.Context(), cred,
		buildUpstreamMessageReq(req, cred))
}

func closeUpstreamBody(log *slog.Logger, resp *http.Response) {
	if cerr := resp.Body.Close(); cerr != nil {
		log.Warn("inference proxy close body", logErrKey, cerr)
	}
}

// resolveStreamCred —— picks owner cred or BYOAI cred (depending on
// session mode) and returns ready-to-use Cred.
func resolveStreamCred(
	r *http.Request, h *Handlers, auth authedVisitor,
	_ *inferenceStreamRequest,
) (*inference.Cred, error) {
	byoai := pickStreamBYOAICred(h, auth, r)
	return h.Visitor.Resolver.Resolve(r.Context(), &inference.ResolveInput{
		OwnerID: auth.Data.OwnerID, Mode: auth.Data.Mode, BYOAI: byoai,
	})
}

func pickStreamBYOAICred(
	h *Handlers, auth authedVisitor, r *http.Request,
) *domain.AICredential {
	if auth.Data.Mode != "byoai" {
		return nil
	}
	cred, _ := readBYOAICredFromHeaders(h, &nopResponseWriter{}, r, auth.Token)
	return cred
}

// nopResponseWriter —— BYOAI envelope helper writes 401 on missing
// headers; the proxy controls response separately, so swallow that
// write. On nil cred + mode=byoai, resolver returns ErrUnconfigured
// which becomes the SSE-level error response.
type nopResponseWriter struct{}

func (*nopResponseWriter) Header() http.Header         { return http.Header{} }
func (*nopResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (*nopResponseWriter) WriteHeader(_ int)           {}

func buildUpstreamMessageReq(
	req *inferenceStreamRequest, cred *inference.Cred,
) *inference.MessageReq {
	model := req.Model
	if model == "" {
		model = cred.Model
	}
	return &inference.MessageReq{
		Model:    model,
		System:   req.System,
		Messages: convertStreamMessages(req.Messages),
		Tools:    convertStreamTools(req.Tools),
	}
}

func convertStreamMessages(in []inferenceStreamMsg) []inference.AnthropicMsg {
	out := make([]inference.AnthropicMsg, 0, len(in))
	for i := range in {
		out = append(out, inference.AnthropicMsg{
			Role: in[i].Role, Content: in[i].Content,
		})
	}
	return out
}

func convertStreamTools(in []inferenceStreamToolIn) []inference.ToolSpec {
	out := make([]inference.ToolSpec, 0, len(in))
	for i := range in {
		out = append(out, inference.ToolSpec{
			Name:        in[i].Name,
			Description: in[i].Description,
			InputSchema: in[i].InputSchema,
		})
	}
	return out
}

// forwardChunkSize —— 4 KiB read window. SSE frames are usually under
// 1 KiB; larger windows give us syscall savings on bigger payloads
// (tool_use input_json with many fields) without holding too much.
const (
	forwardChunkSize = 4096
	logErrKey        = "err"
)

// forwardSSEBytes —— set SSE headers + io.Copy bytes from upstream to
// client. Flushes after each Read so visitors see tokens in real time
// even if intermediary buffering would otherwise hold them.
func forwardSSEBytes(log *slog.Logger, w http.ResponseWriter, body io.Reader) {
	setSSEHeaders(w)
	flusher := pickFlusher(w)
	buf := make([]byte, forwardChunkSize)
	for forwardOneChunk(log, w, flusher, body, buf) {
	}
}

func pickFlusher(w http.ResponseWriter) http.Flusher {
	if f, ok := w.(http.Flusher); ok {
		return f
	}
	return nil
}

func forwardOneChunk(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	body io.Reader, buf []byte,
) bool {
	n, err := body.Read(buf)
	if n > 0 && !writeAndFlush(log, w, flusher, buf[:n]) {
		return false
	}
	return !isReadTerminal(log, err)
}

func writeAndFlush(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher, p []byte,
) bool {
	wn, werr := w.Write(p)
	if werr != nil {
		log.Error("inference proxy write", logErrKey, werr)
		return false
	}
	_ = wn
	if flusher != nil {
		flusher.Flush()
	}
	return true
}

func isReadTerminal(log *slog.Logger, err error) bool {
	if err == nil {
		return false
	}
	if !errors.Is(err, io.EOF) {
		log.Error("inference proxy read", logErrKey, err)
	}
	return true
}

func setSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
}

// writeStreamErr —— pre-stream errors (auth fail, cred resolve fail,
// upstream open fail) become a single SSE `error` event so pi-agent-core
// surfaces them via its error path. Once forwarding has started, errors
// during proxy come from upstream as Anthropic-shape error events and
// pi handles them directly.
func writeStreamErr(log *slog.Logger, w http.ResponseWriter, err error) {
	c := inference.ClassifyStreamErr(err)
	log.Error("inference stream error", logErrKey, err, "code", c.Code)
	setSSEHeaders(w)
	w.WriteHeader(c.Status)
	emitErrorFrame(log, w, err, c.Code)
}

func emitErrorFrame(log *slog.Logger, w http.ResponseWriter, err error, code string) {
	payload, merr := json.Marshal(errorPayload(err, code))
	if merr != nil {
		log.Error("inference stream marshal", logErrKey, merr)
		return
	}
	writeErrorFrame(log, w, payload)
}

func errorPayload(err error, code string) map[string]string {
	return map[string]string{
		"type":    "error",
		"message": err.Error(),
		"code":    code,
	}
}

func writeErrorFrame(log *slog.Logger, w http.ResponseWriter, payload []byte) {
	if _, ferr := fmt.Fprintf(w, "event: error\ndata: %s\n\n", payload); ferr != nil {
		log.Error("inference stream emit", logErrKey, ferr)
		return
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}
