// llm_chat_stream.go —— POST /api/v1/llm/chat/stream
//
// H.2: the new chat entry point; runs through the eino model.ToolCallingChatModel
// abstraction, provider-agnostic to the browser's pi-agent-core.
//
// The handler itself does only 4 things:
//  1. visitor session auth
//  2. decode the body (pi flat-string messages + tools)
//  3. resolve cred (owner row or byoai envelope)
//  4. call inference.Stream to run eino and stream pi-style SSE back
//
// Coexists with the old /inference/stream byte proxy. H.5 cuts the browser's
// pi-agent-core over to this route; H.3 deletes the old path.

package public

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
)

func (h *Handlers) llmChatStream() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		var req inference.ChatRequest
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runLLMChatStream(h, w, r, auth, &req)
	}
}

func runLLMChatStream(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	auth authedVisitor, req *inference.ChatRequest,
) {
	cred, cerr := resolveLLMCred(r, h, auth)
	if cerr != nil {
		// inference.Stream's caller writes the SSE error frame; here we failed before
		// ever entering Stream, so we write it ourselves.
		writeLLMPreStreamErr(h, w, cerr)
		return
	}
	inference.Stream(r.Context(), h.Log, w, cred, req)
}

func resolveLLMCred(
	r *http.Request, h *Handlers, auth authedVisitor,
) (*inference.Cred, error) {
	byoai := pickLLMBYOAICred(h, auth, r)
	return h.Resolver.Resolve(r.Context(), &inference.ResolveInput{
		OwnerID: auth.Data.OwnerID, Mode: auth.Data.Mode, Visitor: byoai,
		ProviderID: auth.Data.ProviderID,
	})
}

func pickLLMBYOAICred(
	h *Handlers, auth authedVisitor, r *http.Request,
) *inference.VisitorCred {
	if auth.Data.Mode != "byoai" {
		return nil
	}
	return readBYOAICredFromHeaders(h, &nopResponseWriter{}, r, auth.Token)
}

func writeLLMPreStreamErr(h *Handlers, w http.ResponseWriter, err error) {
	cls := inference.ClassifyStreamErr(err)
	h.Log.Error("llm chat pre-stream", "err", err, "code", cls.Code)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(cls.Status)
	emitPreStreamErrFrame(h, w, &cls)
}

func emitPreStreamErrFrame(
	h *Handlers, w http.ResponseWriter,
	cls *inference.StreamErrClass,
) {
	// Raw err already logged by writeLLMPreStreamErr; send friendly text to the
	// browser (never leak cred-resolve / model-build / provider internals).
	payload, merr := json.Marshal(preStreamErrBody{
		Code: cls.Code, Message: inference.FriendlyMessage(cls.Code),
	})
	if merr != nil {
		h.Log.Error("llm chat pre-stream marshal", "err", merr)
		return
	}
	writeSSEPayload(h, w, payload)
}

func writeSSEPayload(h *Handlers, w http.ResponseWriter, payload []byte) {
	if _, werr := fmt.Fprintf(w, "event: error\ndata: %s\n\n", payload); werr != nil {
		h.Log.Error("llm chat pre-stream write", "err", werr)
		return
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

type preStreamErrBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
