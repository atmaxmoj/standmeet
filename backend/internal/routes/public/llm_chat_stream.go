// llm_chat_stream.go —— POST /api/v1/llm/chat/stream
//
// H.2: 新 chat 入口；走 eino model.ToolCallingChatModel 抽象，对
// 浏览器 pi-agent-core provider-agnostic。
//
// Handler 自己只做 4 件事：
//  1. visitor session 鉴权
//  2. 解 body (pi 平字符串 messages + tools)
//  3. 解算 cred (owner row 或 byoai envelope)
//  4. 调 inference.Stream 让它跑 eino + 流回 pi-style SSE
//
// 跟老 /inference/stream byte proxy 并存。H.5 浏览器 pi-agent-core 切
// 到这条；H.3 删老 path。

package public

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
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
		// inference.Stream caller 写 SSE error 帧；这里我们没进 Stream
		// 就失败了，自己写。
		writeLLMPreStreamErr(h, w, cerr)
		return
	}
	inference.Stream(r.Context(), h.Log, w, cred, req)
}

func resolveLLMCred(
	r *http.Request, h *Handlers, auth authedVisitor,
) (*inference.Cred, error) {
	byoai := pickLLMBYOAICred(h, auth, r)
	return h.Visitor.Resolver.Resolve(r.Context(), &inference.ResolveInput{
		OwnerID: auth.Data.OwnerID, Mode: auth.Data.Mode, BYOAI: byoai,
	})
}

func pickLLMBYOAICred(
	h *Handlers, auth authedVisitor, r *http.Request,
) *domain.AICredential {
	if auth.Data.Mode != "byoai" {
		return nil
	}
	cred, _ := readBYOAICredFromHeaders(h, &nopResponseWriter{}, r, auth.Token)
	return cred
}

func writeLLMPreStreamErr(h *Handlers, w http.ResponseWriter, err error) {
	cls := inference.ClassifyStreamErr(err)
	h.Log.Error("llm chat pre-stream", "err", err, "code", cls.Code)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(cls.Status)
	emitPreStreamErrFrame(h, w, &cls, err)
}

func emitPreStreamErrFrame(
	h *Handlers, w http.ResponseWriter,
	cls *inference.StreamErrClass, err error,
) {
	payload, merr := json.Marshal(preStreamErrBody{Code: cls.Code, Message: err.Error()})
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
