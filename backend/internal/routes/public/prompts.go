// prompts.go —— GET /api/v1/prompts/{id} —— 单一源 prompt fragment 读取。
//
// Phase D-1: prompts/ 抽到 backend/internal/prompts embed.FS；此 endpoint 让
// 前端 (visitor chat agent loop) 不再依赖 backend 装配，自己 fetch fragment
// 渲入 system prompt。id 支持子路径 (e.g. "capabilities/corpus.retrieval")，
// chi 用通配 wildcard `*` 捕获。返 text/plain；ErrPromptNotFound → 404。

package public

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/prompts"
)

// PromptsHandlers —— prompts route 依赖。embed .md 走包级 prompts.FS；Fallback 由
// composition root 注入（= registry.PromptFragmentText），服务那些已外置进插件
// instructions、不再有 .md 的 capability fragment（GET /prompts/capabilities/<id>）。
type PromptsHandlers struct {
	Log      *slog.Logger
	Fallback func(ctx context.Context, id string) (string, bool)
}

// Mount 挂 GET /prompts/*。caller 负责前缀。
func (h *PromptsHandlers) Mount(r chi.Router) {
	r.Get("/prompts/*", h.get())
}

func (h *PromptsHandlers) get() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "*")
		body, ok := h.loadPromptOrWriteErr(r.Context(), w, id)
		if !ok {
			return
		}
		writePromptBody(h.Log, w, id, body)
	}
}

// loadPromptOrWriteErr —— embed .md 命中即返；未命中 fallback 到 registry（外置能力
// fragment）；都没有 → 404。把错误分流挪出 handler 让 cyclo ≤ 3。
func (h *PromptsHandlers) loadPromptOrWriteErr(
	ctx context.Context, w http.ResponseWriter, id string,
) (string, bool) {
	body, err := prompts.Load(id)
	if err == nil {
		return body, true
	}
	if !errors.Is(err, prompts.ErrPromptNotFound) {
		h.Log.Error("prompts load", "id", id, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return "", false
	}
	return h.fallbackOr404(ctx, w, id)
}

// fallbackOr404 —— embed .md 未命中：试 registry fallback（外置能力 fragment），都没
// 有 → 404。
func (h *PromptsHandlers) fallbackOr404(
	ctx context.Context, w http.ResponseWriter, id string,
) (string, bool) {
	if h.Fallback != nil {
		if text, ok := h.Fallback(ctx, id); ok {
			return text, true
		}
	}
	http.Error(w, "prompt not found", http.StatusNotFound)
	return "", false
}

func writePromptBody(log *slog.Logger, w http.ResponseWriter, id, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write([]byte(body)); werr != nil {
		log.Error("prompts write", "id", id, "err", werr)
	}
}
